// Pricing, deposit and invoice consistency: ONE set of rules from Quote to Checkout to Admin Edit to the saved order.
//
//   - Quote / Checkout / the server booking snapshot agree to the cent (browser code and the server's generated copy are run side by side).
//   - An existing order is a pricing SNAPSHOT: a pricing_rules change does not reprice it; only a component whose basis the Admin
//     actually changed is priced again.
//   - Setup fee is in the total, the balance and the taxable amount, and never in the required deposit.
//   - Weekday delivery, same-day pickup, generator, travel and surface appear once each.
//   - A discount is one amount; tax is 6% rounded once and only when the order's effective tax policy says so; custom fees are
//     whole non-negative cents; a blank deposit override is not a zero deposit.
//
// Pure: no database, no network. (The database side - catch-up, cash/check - is in paymentOperations.test.ts.)
// Run: node node_modules/jiti/bin/jiti.js src/lib/pricingReconciliation.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
const fs = require('fs');

import { calculatePrice, type PricingRules } from '../../pricing';
import { composeUnifiedQuoteTotals } from '../../pricing/unifiedTotals';
import { parseBookingDepositSettings } from '../../pricing/depositCalculation';
import { calculateOrderPricing, shouldReuseSavedTravel, type CalculatePricingParams, type CalculatedPricing } from '../../pricing/orderPricingCalculation';
import { planOrderChanges } from '../../orders/orderChangePlanning';
import { storedOrderTotalCents } from '../../pricing/orderMoney';
import { receiptOrderFigures, receiptExtraFeeRowsHtml } from '../../../../supabase/functions/_shared/payments/receipt-order-totals';
import { storedFeeAmounts } from '../../pricing/orderFeeDisplay';
import { orderPricingState, sameOrderPricingState } from '../../pricing/orderPricingState';
import { buildOrderSummaryDisplay } from '../../orders/orderSummaryDisplay';
import { composeUnifiedQuoteTotals as serverCompose } from '../../../../supabase/functions/_shared/booking/unifiedTotals';
import { calculatePrice as serverCalculatePrice } from '../../../../supabase/functions/_shared/booking/pricing';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label} (got ${a}, expected ${e})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------
const RULES: PricingRules = {
  base_radius_miles: 10,
  included_city_list_json: ['Plymouth'],
  per_mile_after_base_cents: 250,
  zone_overrides_json: [],
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
  same_day_matrix_json: null,
  ee_only_deposit_base_threshold_cents: 20000,
  ee_only_deposit_base_cents: 5000,
  ee_only_deposit_subtotal_step_cents: 10000,
  ee_only_deposit_step_cents: 5000,
  event_essentials_setup_minimum_cents: 15000,
};
// The historical configuration: tax is OFF unless an order turns it on.
const RULES_TAX_OFF: PricingRules = { ...RULES, apply_taxes_by_default: false };
// The same business a year later: every priced rule moved.
const RULES_LATER: PricingRules = {
  ...RULES,
  surface_sandbag_fee_cents: 5000,
  residential_multiplier: 1.2,
  commercial_multiplier: 1.5,
  extra_day_pct: 75,
  same_day_pickup_fee_cents: 15000,
  same_day_weekday_delivery_fee_cents: 4000,
  generator_fee_single_cents: 14000,
  generator_fee_multiple_cents: 9000,
  per_mile_after_base_cents: 400,
  deposit_per_unit_cents: 7500,
  apply_taxes_by_default: false,
};

const unit = (id: string, qty: number, price: number, mode: 'dry' | 'water' = 'dry', over: Record<string, unknown> = {}) =>
  ({ unit_id: id, unit_name: `Unit ${id}`, qty, wet_or_dry: mode, unit_price_cents: price, ...over });
const ee = (id: string, qty: number, price: number, over: Record<string, unknown> = {}) =>
  ({ product_id: id, product_name: `Product ${id}`, qty, unit_price_cents: price, pricing_context: 'standalone', ...over });

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

function distanceFor(params: CalculatePricingParams, io: number): number {
  if (shouldReuseSavedTravel(params.eventDetails, params.existingOrder)) return parseFloat(String(params.existingOrder?.travel_total_miles)) || 0;
  return io || parseFloat(String(params.existingOrder?.travel_total_miles)) || 0;
}
function price(params: CalculatePricingParams, io = 14.2, sameDay = false): CalculatedPricing {
  const r = calculateOrderPricing(params, { distanceMiles: distanceFor(params, io), isSameDayWeekdayDelivery: () => sameDay });
  if (r.status !== 'ok') throw new Error('pricing failed: ' + r.error);
  return r.calculatedPricing;
}

// The order row the app persists from a pricing result (what planOrderChanges writes), i.e. the saved snapshot.
function savedOrder(p: CalculatedPricing, params: CalculatePricingParams, over: Record<string, unknown> = {}): any {
  return {
    id: 'o1', status: 'confirmed',
    location_type: params.eventDetails.location_type, surface: params.eventDetails.surface, generator_qty: params.eventDetails.generator_qty,
    start_window: '10:00', end_window: '12:00', event_date: params.eventDetails.event_date, event_end_date: params.eventDetails.event_end_date,
    pickup_preference: params.eventDetails.pickup_preference,
    addresses: { line1: params.eventDetails.address_line1, city: params.eventDetails.address_city, state: params.eventDetails.address_state, zip: params.eventDetails.address_zip },
    subtotal_cents: p.subtotal_cents, generator_fee_cents: p.generator_fee_cents, setup_fee_cents: p.setup_fee_cents,
    event_essentials_subtotal_cents: p.event_essentials_subtotal_cents,
    travel_fee_cents: p.travel_fee_cents, travel_total_miles: p.travel_total_miles, surface_fee_cents: p.surface_fee_cents,
    same_day_pickup_fee_cents: p.same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents: p.same_day_weekday_delivery_fee_cents,
    tax_cents: p.tax_cents, deposit_due_cents: p.deposit_due_cents, balance_due_cents: p.balance_due_cents,
    deposit_paid_cents: p.deposit_due_cents, balance_paid_cents: 0, tip_cents: 0, custom_deposit_cents: null,
    travel_base_radius_miles: p.travel_base_radius_miles ?? null, travel_chargeable_miles: p.travel_chargeable_miles ?? null, travel_per_mile_cents: p.travel_per_mile_cents ?? null, travel_is_flat_fee: p.travel_is_flat_fee ?? false,
    tax_waived: false, travel_fee_waived: false, surface_fee_waived: false, same_day_pickup_fee_waived: false,
    generator_fee_waived: false, same_day_weekday_delivery_fee_waived: false, require_card_on_file: true, admin_message: '',
    ...over,
  };
}
const moneyKeys = ['subtotal_cents', 'travel_fee_cents', 'surface_fee_cents', 'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents', 'generator_fee_cents', 'setup_fee_cents', 'tax_cents', 'deposit_due_cents', 'balance_due_cents', 'custom_deposit_cents', 'event_essentials_subtotal_cents'];

// =====================================================================================================================
// 1. Quote, Checkout and the server's booking snapshot agree to the cent
// =====================================================================================================================
{
  const settings = parseBookingDepositSettings(RULES);
  if (settings.status !== 'ready') throw new Error('fixture deposit settings invalid');
  const ONE = (id: string, price: number, qty = 1) => ({ item_type: 'inflatable', unit_id: id, unit_name: `Unit ${id}`, wet_or_dry: 'dry', unit_price_cents: price, price_dry_cents: price, price_water_cents: price + 5000, qty }) as any;
  const PROD = (id: string, price: number, qty = 1) => ({ item_type: 'event_essential_product', product_id: id, product_name: `Product ${id}`, unit_price_cents: price, qty, pricing_context: 'standalone' }) as any;

  const scenarios: Array<{ label: string; rules: PricingRules; units: any[]; products: any[]; event: Record<string, any>; sameDay?: boolean; dist?: number }> = [
    { label: 'one inflatable', rules: RULES, units: [ONE('u1', 25000)], products: [], event: {} },
    { label: 'two inflatables, commercial, cement, two days', rules: RULES, units: [ONE('u1', 25000), ONE('u2', 31250, 2)], products: [], event: { location_type: 'commercial', surface: 'cement', event_end_date: '2026-07-05' } },
    { label: 'generator and same-day pickup are separate', rules: RULES, units: [ONE('u1', 25000)], products: [], event: { pickup_preference: 'same_day', generator_qty: 2 } },
    { label: 'weekday delivery fee', rules: RULES, units: [ONE('u1', 25000)], products: [], event: {}, sameDay: true },
    { label: 'travel beyond the base radius', rules: RULES, units: [ONE('u1', 25000)], products: [], event: {}, dist: 31.7 },
    { label: 'inflatable plus Event Essentials', rules: RULES, units: [ONE('u1', 25000)], products: [PROD('p1', 9500)], event: {} },
    { label: 'Event Essentials only, below the setup minimum (setup fee)', rules: RULES, units: [], products: [PROD('p1', 9000)], event: {} },
    { label: 'Event Essentials only, above the setup minimum', rules: RULES, units: [], products: [PROD('p1', 40000, 2)], event: {} },
    { label: 'tax disabled by the business default', rules: RULES_TAX_OFF, units: [ONE('u1', 25000)], products: [PROD('p1', 9500)], event: {} },
    { label: 'tax on two pieces that would round differently apart than together', rules: RULES, units: [ONE('u1', 825)], products: [PROD('p1', 825)], event: {}, dist: 5 },
    { label: 'fractional-cent tax (odd amounts)', rules: RULES, units: [ONE('u1', 24999)], products: [PROD('p1', 8333)], event: {}, dist: 13.3 },
  ];
  for (const s of scenarios) {
    const items = s.units.map((u) => ({ unit_id: u.unit_id, unit_name: u.unit_name, qty: u.qty, wet_or_dry: u.wet_or_dry, unit_price_cents: u.unit_price_cents }));
    const eeItems = s.products.map((p) => ({ product_id: p.product_id, product_name: p.product_name, qty: p.qty, unit_price_cents: p.unit_price_cents, pricing_context: 'standalone' }));
    const params = base({ items, eeProductItems: eeItems, pricingRules: s.rules, event: s.event });
    const dist = s.dist ?? 14.2;
    const checkout = price(params, dist, !!s.sameDay);

    // Quote: the inflatable price breakdown, then the unified composer (what the Quote and the Checkout pages show)
    const ev = params.eventDetails;
    const days = Math.ceil(Math.abs(new Date(ev.event_end_date).getTime() - new Date(ev.event_date).getTime()) / 86400000) + 1;
    const pricingInput = {
      items: items.map((i) => ({ unit_id: i.unit_id, wet_or_dry: i.wet_or_dry as 'dry' | 'water', unit_price_cents: i.unit_price_cents, qty: i.qty })),
      location_type: ev.location_type, surface: ev.surface, can_use_stakes: ev.surface === 'grass', overnight_allowed: ev.pickup_preference === 'next_day',
      num_days: days, distance_miles: dist, city: ev.address_city, zip: ev.address_zip, has_generator: false, generator_qty: ev.generator_qty,
      is_same_day_weekday_delivery: !!s.sameDay, rules: s.rules,
    };
    const bd = calculatePrice(pricingInput);
    const dep = parseBookingDepositSettings(s.rules);
    if (dep.status !== 'ready') throw new Error('deposit');
    const cart = [...s.units, ...s.products];
    const composeInput = {
      inflatableBreakdown: bd, cart, taxApplied: bd.tax_applied ?? true,
      eeOnlyDepositSettings: dep.eventEssentialsDepositSettings, inflatableDepositPerUnitCents: dep.inflatableDepositPerUnitCents, setupMinimumCents: dep.setupMinimumCents,
    };
    const quote = composeUnifiedQuoteTotals(composeInput);
    // The server's generated copy, exactly as create-booking runs it
    const serverBd = serverCalculatePrice(pricingInput as any);
    const server = serverCompose({ ...composeInput, inflatableBreakdown: serverBd } as any);

    const pick = (q: any) => ({ subtotal: q.equipmentSubtotalCents, travel: q.travelFeeCents, surface: q.surfaceFeeCents, pickup: q.sameDayPickupFeeCents, weekday: q.sameDayWeekdayDeliveryFeeCents, generator: q.generatorFeeCents, setup: q.setupFeeCents, tax: q.taxCents, total: q.totalCents, deposit: q.depositCents });
    const fromCheckout = { subtotal: checkout.subtotal_cents, travel: checkout.travel_fee_cents, surface: checkout.surface_fee_cents, pickup: checkout.same_day_pickup_fee_cents, weekday: checkout.same_day_weekday_delivery_fee_cents, generator: checkout.generator_fee_cents, setup: checkout.setup_fee_cents, tax: checkout.tax_cents, total: checkout.total_cents, deposit: checkout.deposit_due_cents };
    // The generator in the Quote comes through generator_qty on the breakdown input too
    eq(`${s.label}: Quote == Checkout (subtotal, every fee, setup, tax, total, deposit)`, pick(quote), fromCheckout);
    eq(`${s.label}: the server's booking snapshot == Quote`, pick(server), pick(quote));
  }
}

// =====================================================================================================================
// 2. Setup fee: in the total, the balance and the tax - never in the required deposit
// =====================================================================================================================
{
  const eeOnly = (customSetup: number | null, rules = RULES) => price(base({ items: [], eeProductItems: [ee('p1', 1, 9000)], customSetupFeeCents: customSetup, pricingRules: rules }));
  const none = eeOnly(0);
  const some = eeOnly(5500);
  const more = eeOnly(9500);
  eq('setup fee: the calculated fee for a $90 Event Essentials order is $60', eeOnly(null).setup_fee_cents, 6000);
  eq('setup fee raises the total by exactly the fee plus its tax', some.total_cents - none.total_cents, 5500 + (some.tax_cents - none.tax_cents));
  ok('setup fee is taxed (tax is higher with the fee)', some.tax_cents > none.tax_cents && some.tax_cents - none.tax_cents === Math.round((9000 + 5500) * 0.06) - Math.round(9000 * 0.06));
  eq('setup fee does not change the required deposit', [none.deposit_due_cents, some.deposit_due_cents, more.deposit_due_cents], [none.deposit_due_cents, none.deposit_due_cents, none.deposit_due_cents]);
  eq('setup fee raises the balance by the whole increase in the total', some.balance_due_cents - none.balance_due_cents, some.total_cents - none.total_cents);
  ok('setup fee: the deposit is the Event Essentials tier of the EQUIPMENT only', none.deposit_due_cents === 5000);
  ok('setup fee with tax disabled adds to the total but no tax', eeOnly(5500, RULES_TAX_OFF).total_cents - eeOnly(0, RULES_TAX_OFF).total_cents === 5500 && eeOnly(5500, RULES_TAX_OFF).tax_cents === 0);
  // the same through the Quote composer
  const dep = parseBookingDepositSettings(RULES);
  if (dep.status !== 'ready') throw new Error('x');
  const quoteWith = (eeCents: number) => composeUnifiedQuoteTotals({
    inflatableBreakdown: calculatePrice({ items: [], location_type: 'residential', surface: 'grass', can_use_stakes: true, overnight_allowed: true, num_days: 1, distance_miles: 5, city: 'Detroit', zip: '48201', has_generator: false, rules: RULES }),
    cart: [{ item_type: 'event_essential_product', product_id: 'p', product_name: 'P', unit_price_cents: eeCents, qty: 1, pricing_context: 'standalone' } as any],
    taxApplied: true, eeOnlyDepositSettings: dep.eventEssentialsDepositSettings, inflatableDepositPerUnitCents: dep.inflatableDepositPerUnitCents, setupMinimumCents: dep.setupMinimumCents,
  });
  ok('Quote: a smaller Event Essentials subtotal has a larger setup fee in the total but the deposit follows the equipment tier only', quoteWith(9000).setupFeeCents === 6000 && quoteWith(9000).depositCents === 5000 && quoteWith(9000).totalCents === 9000 + 6000 + Math.round(15000 * 0.06));
}

// =====================================================================================================================
// 3. Weekday delivery, same-day pickup, generator, travel, surface: each once
// =====================================================================================================================
{
  const baseline = price(base());
  const weekday = price(base(), 14.2, true);
  eq('weekday delivery fee: appears once, in the total once', [weekday.same_day_weekday_delivery_fee_cents, weekday.total_cents - baseline.total_cents], [2500, 2500]);
  ok('weekday delivery fee is not taxed', weekday.tax_cents === baseline.tax_cents);
  eq('weekday delivery fee does not change the deposit', weekday.deposit_due_cents, baseline.deposit_due_cents);
  eq('weekday delivery fee waived: the total excludes it', price(base({ feeWaivers: { sameDayWeekdayDeliveryFeeWaived: true } }), 14.2, true).total_cents, baseline.total_cents);

  const pickup = price(base({ event: { pickup_preference: 'same_day' } }));
  eq('same-day pickup fee: appears once, in the total once', [pickup.same_day_pickup_fee_cents, pickup.total_cents - baseline.total_cents], [10500, 10500]);
  ok('same-day pickup fee is not taxed', pickup.tax_cents === baseline.tax_cents);

  const gen = price(base({ event: { generator_qty: 1 } }));
  eq('generator fee: its own component, taxed, once', [gen.generator_fee_cents, gen.total_cents - baseline.total_cents], [10000, 10000 + (gen.tax_cents - baseline.tax_cents)]);
  const genAndPickup = price(base({ event: { generator_qty: 1, pickup_preference: 'same_day' } }));
  eq('generator and same-day pickup are separate components (both charged, neither folded into the other)', [genAndPickup.generator_fee_cents, genAndPickup.same_day_pickup_fee_cents], [10000, 10500]);
  eq('generator + same-day pickup: the total carries each once', genAndPickup.total_cents - baseline.total_cents, 10000 + 10500 + (genAndPickup.tax_cents - baseline.tax_cents));
  eq('two generators: the first at the single price, the second at the multiple price', price(base({ event: { generator_qty: 2 } })).generator_fee_cents, 17500);

  const far = price(base(), 31.7);
  eq('travel fee: beyond the base radius, once', [far.travel_fee_cents > 0, far.total_cents - baseline.total_cents - (far.tax_cents - baseline.tax_cents)], [true, far.travel_fee_cents - baseline.travel_fee_cents]);
  const cement = price(base({ event: { surface: 'cement' } }));
  eq('surface (sandbag) fee: from the configured rule, once', [cement.surface_fee_cents, cement.total_cents - baseline.total_cents - (cement.tax_cents - baseline.tax_cents)], [3500, 3500]);
}

// =====================================================================================================================
// 4. Existing orders are pricing snapshots
// =====================================================================================================================
{
  // Order A is booked under today's rules: cement, commercial, 2 days, pickup + weekday + generator + travel.
  const bookedParams = base({
    items: [unit('u1', 2, 25000)], event: { location_type: 'commercial', surface: 'cement', event_end_date: '2026-07-05', pickup_preference: 'same_day', generator_qty: 1 },
    customFees: [{ name: 'Delivery help', amount_cents: 2000 }], discounts: [{ name: 'Promo', percentage: 10 }],
  });
  const booked = price(bookedParams, 31.7, true);
  const order = savedOrder(booked, bookedParams);
  // the money of an order saved as the app saves it
  eq('A: booked total is the sum of its parts', booked.total_cents, storedOrderTotalCents(order, [{ percentage: 10 }], [{ amount_cents: 2000 }]));

  // The Admin opens it later, after pricing_rules moved, and changes ONLY a note. The editor recalculates against the NEW rules.
  const edit = (over: Record<string, any> = {}) => base({
    ...bookedParams, pricingRules: RULES_LATER, existingOrder: order, storedSetupFeeCents: 0, equipmentBasisChanged: false,
    ...over,
  });
  const reedited = price(edit(), 40, false);
  for (const k of ['subtotal_cents', 'travel_fee_cents', 'surface_fee_cents', 'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents', 'generator_fee_cents', 'setup_fee_cents', 'tax_cents', 'total_cents'] as const) {
    ok(`snapshot: an unrelated edit after a pricing_rules change keeps ${k}`, (reedited as any)[k] === (k === 'total_cents' ? booked.total_cents : (booked as any)[k]));
  }
  eq('snapshot: ...and the deposit (not re-read from today\'s per-unit rule)', reedited.deposit_due_cents, booked.deposit_due_cents);
  eq('snapshot: ...and the balance', reedited.balance_due_cents, booked.balance_due_cents);

  // The save planner writes NOTHING financial for a note-only edit
  const plan = planOrderChanges({
    order, editedOrder: { ...order, address_line1: order.addresses.line1, address_line2: '', address_city: order.addresses.city, address_state: order.addresses.state, address_zip: order.addresses.zip },
    stagedItems: [{ id: 'i1', unit_id: 'u1', unit_name: 'Unit u1', qty: 2, wet_or_dry: 'dry', unit_price_cents: 25000 }], discounts: [{ percentage: 10 }], customFees: [{ amount_cents: 2000 }], calculatedPricing: reedited, customDepositCents: null, customSetupFeeCents: null,
    adminMessage: 'Customer asked for a gate code', canonicalAddressId: undefined,
  } as any, { calculateTotal: (o: any, d: any[], f: any[]) => storedOrderTotalCents(o, d, f) });
  const financial = Object.keys(plan.changes).filter((k) => moneyKeys.includes(k) || k === 'custom_deposit_cents');
  eq('snapshot: a note-only save writes no financial field at all', financial, []);
  eq('snapshot: ...only the message (and the view stamp) changes', Object.keys(plan.changes).filter((k) => k !== 'status'), ['admin_message']);

  // A NEW order priced today uses the new rules
  const fresh = price(bookedParams, 31.7, true);
  const freshLater = price({ ...bookedParams, pricingRules: RULES_LATER }, 31.7, true);
  ok('a new Quote/order uses the new rules (and so differs from the old one)', freshLater.total_cents !== fresh.total_cents && freshLater.surface_fee_cents === 5000 && freshLater.same_day_pickup_fee_cents === 15000);

  // An intentional change reprices exactly the component whose basis changed
  const addressMoved = price(edit({ eventDetails: { ...bookedParams.eventDetails, address_line1: '9 Far Rd', address_zip: '48000' } }), 40, false);
  ok('change address: travel is priced again (from today\'s per-mile rule)', addressMoved.travel_fee_cents !== booked.travel_fee_cents);
  eq('change address: the booked equipment subtotal stays historical', addressMoved.subtotal_cents, booked.subtotal_cents);
  eq('change address: the surface fee stays historical', addressMoved.surface_fee_cents, booked.surface_fee_cents);
  eq('change address: the same-day pickup fee stays historical', addressMoved.same_day_pickup_fee_cents, booked.same_day_pickup_fee_cents);

  const equipmentChanged = price(edit({ items: [unit('u1', 3, 25000)], equipmentBasisChanged: true }), 40, false);
  ok('change equipment: the subtotal is priced again (3 units at today\'s multiplier)', equipmentChanged.subtotal_cents === Math.round(3 * 25000 * 1.5) + Math.round(Math.round(3 * 25000 * 1.5) * 0.75));
  ok('change equipment: the deposit follows the new unit count', equipmentChanged.deposit_due_cents === Math.min(3 * 7500, equipmentChanged.total_cents));

  const pickupChanged = price(edit({ eventDetails: { ...bookedParams.eventDetails, pickup_preference: 'next_day' } }), 40, false);
  ok('change pickup preference: the same-day pickup fee is recomputed exactly once', pickupChanged.same_day_pickup_fee_cents === (bookedParams.eventDetails.location_type === 'commercial' ? 15000 : 0));

  const setupChange = price(edit({ items: [], eeProductItems: [ee('p1', 1, 9000)], equipmentBasisChanged: true, customSetupFeeCents: 4000 }), 40, false);
  ok('change setup condition: the setup fee changes the total and the balance but not the equipment deposit', setupChange.setup_fee_cents === 4000);

  // The tax decision of an order is part of its snapshot: the business default flipped, the order was not touched
  const taxedBefore = price(base({ pricingRules: RULES }));
  const taxedOrder = savedOrder(taxedBefore, base({ pricingRules: RULES }));
  const afterFlip = price(base({ pricingRules: RULES_TAX_OFF, existingOrder: taxedOrder, storedSetupFeeCents: 0 }));
  eq('tax decision: an order taxed when saved stays taxed after the business default turns tax off', afterFlip.tax_cents, taxedBefore.tax_cents);
  const flippedByAdmin = price(base({ pricingRules: RULES, existingOrder: taxedOrder, storedSetupFeeCents: 0, feeWaivers: { taxWaived: true } }));
  eq('tax decision: the Admin waiving tax on that order does change it (to zero)', flippedByAdmin.tax_cents, 0);
}

// =====================================================================================================================
// 5. Discounts
// =====================================================================================================================
{
  const noDisc = price(base());
  const d = (discounts: any[]) => price(base({ discounts }));
  eq('discount: fixed', noDisc.total_cents - d([{ name: 'F', amount_cents: 2500 }]).total_cents, 2500 + (noDisc.tax_cents - d([{ name: 'F', amount_cents: 2500 }]).tax_cents));
  eq('discount: percentage of the equipment subtotal', d([{ name: 'P', percentage: 10 }]).discount_total_cents, 2500);
  eq('discount: a row with BOTH -> the fixed amount only', d([{ name: 'B', amount_cents: 1000, percentage: 50 }]).discount_total_cents, 1000);
  eq('discount: the returned discount figure and the total agree (one number)', (() => { const r = d([{ name: 'B', amount_cents: 1000, percentage: 50 }]); return noDisc.total_cents - r.total_cents - (noDisc.tax_cents - r.tax_cents); })(), 1000);
  eq('discount: equal to everything discountable gives a zero total', d([{ name: 'All', amount_cents: noDisc.total_cents }]).total_cents >= 0, true);
  const huge = d([{ name: 'Big', amount_cents: 99999999 }]);
  eq('discount: larger than the order is clamped; the total is never negative', [huge.total_cents, huge.tax_cents, huge.deposit_due_cents, huge.balance_due_cents], [0, 0, 0, 0]);
  eq('discount: zero', d([{ name: 'Z', amount_cents: 0, percentage: 0 }]).total_cents, noDisc.total_cents);
  eq('discount: negative malformed values are nothing', d([{ name: 'N', amount_cents: -500 }, { name: 'M', percentage: -10 }]).total_cents, noDisc.total_cents);
  eq('discount: a fractional-cent percentage is deterministic (12.5% of 8333)', price(base({ items: [unit('u1', 1, 8333)], discounts: [{ name: 'F', percentage: 12.5 }] })).discount_total_cents, 1042);
  eq('discount: several together', d([{ name: 'A', amount_cents: 1000 }, { name: 'B', percentage: 5 }]).discount_total_cents, 1000 + 1250);
  eq('discount: the discount lowers the taxable amount', (() => { const r = d([{ name: 'F', amount_cents: 2500 }]); return r.tax_cents; })(), Math.round((25000 + (noDisc.travel_fee_cents) - 2500) * 0.06));
}

// =====================================================================================================================
// 6. Tax
// =====================================================================================================================
{
  const on = price(base());
  const off = price(base({ pricingRules: RULES_TAX_OFF }));
  const waived = price(base({ feeWaivers: { taxWaived: true } }));
  const offToggled = price(base({ pricingRules: RULES_TAX_OFF, feeWaivers: { taxWaived: true } }));
  ok('tax: enabled -> 6% of the taxable amount', on.tax_cents === Math.round((25000 + on.travel_fee_cents) * 0.06) && on.tax_cents > 0);
  eq('tax: the historical default (apply_taxes_by_default = false) -> zero', off.tax_cents, 0);
  eq('tax: waived -> zero', waived.tax_cents, 0);
  eq('tax: default off + toggled on -> 6%', offToggled.tax_cents, on.tax_cents);
  eq('tax: totals differ only by the tax', [on.total_cents - off.total_cents, waived.total_cents - off.total_cents], [on.tax_cents, 0]);
  const odd = price(base({ items: [unit('u1', 1, 24999)], eeProductItems: [ee('p1', 1, 8333)], event: { address_zip: '48000' } }), 13.3);
  eq('tax: a fractional-cent result rounds once', odd.tax_cents, Math.round((24999 + 8333 + odd.travel_fee_cents + odd.setup_fee_cents) * 0.06));
  const dTax = price(base({ discounts: [{ name: 'D', amount_cents: 5000 }] }));
  eq('tax: discount then tax - the discount reduces the taxable amount', dTax.tax_cents, Math.round((25000 + dTax.travel_fee_cents - 5000) * 0.06));
  const sd = price(base({ event: { pickup_preference: 'same_day' } }), 14.2, true);
  eq('tax: neither same-day pickup nor weekday delivery is taxed', sd.tax_cents, on.tax_cents);
}

// =====================================================================================================================
// 7. Custom fees
// =====================================================================================================================
{
  const noFee = price(base());
  const f = (customFees: any[]) => price(base({ customFees }));
  const taxOn = (cents: number) => Math.round((25000 + noFee.travel_fee_cents + cents) * 0.06);
  eq('custom fee: one', f([{ name: 'A', amount_cents: 1500 }]).custom_fees_total_cents, 1500);
  eq('custom fee: it is taxed and in the total', f([{ name: 'A', amount_cents: 1500 }]).total_cents - noFee.total_cents, 1500 + taxOn(1500) - noFee.tax_cents);
  eq('custom fees: several, deterministic', f([{ name: 'A', amount_cents: 1500 }, { name: 'B', amount_cents: 700 }]).custom_fees_total_cents, 2200);
  eq('custom fee: zero is fine', f([{ name: 'Z', amount_cents: 0 }]).total_cents, noFee.total_cents);
  eq('custom fee: negative is ignored (never a hidden discount)', f([{ name: 'N', amount_cents: -2000 }]).total_cents, noFee.total_cents);
  eq('custom fee: NaN is ignored', f([{ name: 'N', amount_cents: Number.NaN }]).total_cents, noFee.total_cents);
  eq('custom fee: a missing amount is ignored', f([{ name: 'M' }]).total_cents, noFee.total_cents);
  eq('custom fee: fractional cents are ignored', f([{ name: 'F', amount_cents: 12.5 }]).total_cents, noFee.total_cents);
  eq('custom fee: the returned total matches the stored-order total formula', (() => {
    const params = base({ customFees: [{ name: 'A', amount_cents: 1500 }], discounts: [{ name: 'D', percentage: 10 }] });
    const p = price(params);
    return p.total_cents - storedOrderTotalCents(savedOrder(p, params), [{ percentage: 10 }], [{ amount_cents: 1500 }]);
  })(), 0);
}

// =====================================================================================================================
// 8. The deposit override: no override is not zero
// =====================================================================================================================
{
  const formula = price(base());
  eq('deposit: no override -> the formula (units x per-unit)', formula.deposit_due_cents, 5000);
  eq('deposit: an explicit override of 0 is a deliberate no-deposit', price(base({ customDepositCents: 0 })).deposit_due_cents, 0);
  eq('deposit: a positive override is that deposit', price(base({ customDepositCents: 8000 })).deposit_due_cents, 8000);
  eq('deposit: an override above the total is capped at the total', price(base({ customDepositCents: 99999999 })).deposit_due_cents, formula.total_cents);
  eq('deposit: balance = total - deposit', (() => { const r = price(base({ customDepositCents: 8000 })); return r.total_cents - r.deposit_due_cents - r.balance_due_cents; })(), 0);
  ok('deposit: null and 0 are different results', price(base({ customDepositCents: null })).deposit_due_cents !== price(base({ customDepositCents: 0 })).deposit_due_cents);

  // saved with the order, so the next edit starts from the same state
  const params = base({ customDepositCents: 0 });
  const p = price(params);
  const order = savedOrder(p, params, { custom_deposit_cents: null, deposit_paid_cents: 0, deposit_due_cents: 5000, status: 'pending_review' });
  const planFor = (customDepositCents: number | null, saved: number | null) => planOrderChanges({
    order: { ...order, custom_deposit_cents: saved }, editedOrder: { ...order, address_line1: '1 Main St', address_line2: '', address_city: 'Detroit', address_state: 'MI', address_zip: '48201' },
    stagedItems: [], discounts: [], customFees: [], calculatedPricing: price(base({ customDepositCents })), customDepositCents, customSetupFeeCents: null, adminMessage: '', canonicalAddressId: undefined,
  } as any, { calculateTotal: (o: any, d: any[], fees: any[]) => storedOrderTotalCents(o, d, fees) });
  eq('deposit override 0 is saved as 0 (not dropped as "falsy")', (planFor(0, null).changes as any).custom_deposit_cents, 0);
  eq('deposit override 8000 is saved', (planFor(8000, null).changes as any).custom_deposit_cents, 8000);
  eq('clearing an override saves null (the formula applies again)', (planFor(null, 8000).changes as any).custom_deposit_cents, null);
  ok('an unchanged override writes nothing', !('custom_deposit_cents' in (planFor(8000, 8000).changes as any)));

  // a stored formula deposit is a snapshot while the equipment is unchanged; an override cleared recalculates
  const saved = savedOrder(price(base()), base(), { custom_deposit_cents: null });
  eq('deposit snapshot: the stored formula deposit survives a per-unit rule change', price(base({ pricingRules: RULES_LATER, existingOrder: saved, storedSetupFeeCents: 0 })).deposit_due_cents, 5000);
  const savedOverride = savedOrder(price(base({ customDepositCents: 9000 })), base({ customDepositCents: 9000 }), { custom_deposit_cents: 9000 });
  eq('deposit snapshot: clearing a saved override recalculates from today\'s rule', price(base({ pricingRules: RULES_LATER, existingOrder: savedOverride, storedSetupFeeCents: 0, customDepositCents: null })).deposit_due_cents, 7500);
}

// =====================================================================================================================
// 9. Waived fees keep the amount that was waived (for "$X - Waived") while the charged total excludes it
// =====================================================================================================================
{
  const params = base({ event: { surface: 'cement', pickup_preference: 'same_day', generator_qty: 1 }, feeWaivers: { surfaceFeeWaived: true, sameDayPickupFeeWaived: true, generatorFeeWaived: true } });
  const r = calculateOrderPricing(params, { distanceMiles: 14.2, isSameDayWeekdayDelivery: () => false });
  if (r.status !== 'ok') throw new Error('x');
  eq('waived fees: the charged total excludes them', [r.calculatedPricing.surface_fee_cents, r.calculatedPricing.same_day_pickup_fee_cents, r.calculatedPricing.generator_fee_cents], [0, 0, 0]);
  eq('waived fees: the underlying amounts are preserved for display', [r.orderData.surface_fee_cents, r.orderData.same_day_pickup_fee_cents, r.orderData.generator_fee_cents], [3500, 10500, 10000]);
  eq('waived fees: ...and the display says so', [r.orderData.surface_fee_cents > 0, r.calculatedPricing.generator_fee_before_waiver_cents], [true, 10000]);
}

// =====================================================================================================================
// 9b. The receipts show the same figures as the order
// =====================================================================================================================
{
  const order = { subtotal_cents: 25000, travel_fee_cents: 2000, surface_fee_cents: 3500, same_day_pickup_fee_cents: 10500, same_day_weekday_delivery_fee_cents: 2500, generator_fee_cents: 10000, setup_fee_cents: 5500, tax_cents: 2400, tip_cents: 900 };
  const discounts = [{ amount_cents: 1000, percentage: 20 }];
  const fees = [{ amount_cents: 500 }];
  const figures = receiptOrderFigures(order, discounts, fees);
  eq('receipt: the total is the order total (weekday delivery fee and setup fee included, tip excluded)', figures.total, storedOrderTotalCents(order, discounts, fees));
  eq('receipt: the total in cents', figures.total, 25000 + 2000 + 3500 + 10500 + 2500 + 10000 + 5500 + 2400 + 500 - 1000);
  eq('receipt: the discount is one amount', figures.discountsTotal, 1000);
  ok('receipt: the weekday delivery fee and the setup fee get their own rows', /Same-Day Delivery Fee/.test(receiptExtraFeeRowsHtml(figures, (c: number) => '$' + c)) && /Setup Fee/.test(receiptExtraFeeRowsHtml(figures, (c: number) => '$' + c)));
  eq('receipt: a stored tax is shown whatever the tax toggle says', receiptOrderFigures({ ...order, tax_waived: true }, [], []).tax, 2400);
}

// =====================================================================================================================
// 9c. A waived fee never shows TODAY'S rule as its historical amount
// =====================================================================================================================
{
  const waivedTravel = { travelFeeWaived: true };
  // 2026: the order is booked with the travel fee waived. The fee would have been $X under the rules of the day.
  const bookedParams = base({ feeWaivers: waivedTravel });
  const booked = calculateOrderPricing(bookedParams, { distanceMiles: 14.2, isSameDayWeekdayDelivery: () => false });
  if (booked.status !== 'ok') throw new Error('x');
  const wouldHaveBeen = booked.calculatedPricing.waived_fee_amounts_cents.travel as number;
  ok('waived: a newly waived fee records what it would have cost under the rules of the day', wouldHaveBeen === Math.round((14.2 - 10) * 250) && booked.calculatedPricing.travel_fee_cents === 0);
  const stored = savedOrder(booked.calculatedPricing, bookedParams, { travel_fee_waived: true, travel_fee_cents: 0, waived_fee_amounts_cents: booked.calculatedPricing.waived_fee_amounts_cents });

  // 2027: the per-mile rule moves. The same order is opened (and edited for a note).
  const later = calculateOrderPricing(base({ pricingRules: RULES_LATER, feeWaivers: waivedTravel, existingOrder: stored, storedSetupFeeCents: 0 }), { distanceMiles: 14.2, isSameDayWeekdayDelivery: () => false });
  if (later.status !== 'ok') throw new Error('x');
  eq('waived: after the rule changed the order still shows the amount it was waived at', later.orderData.travel_fee_cents, wouldHaveBeen);
  eq('waived: ...and the kept amount is unchanged', later.calculatedPricing.waived_fee_amounts_cents, { travel: wouldHaveBeen });
  ok('waived: ...and it is NOT today\'s amount', Math.round((14.2 - 10) * 400) !== wouldHaveBeen);
  eq('waived: the stored-order display agrees', storedFeeAmounts(stored).travel_fee_cents, wouldHaveBeen);

  // a legacy waiver: no amount was ever stored
  const legacy = { ...stored, waived_fee_amounts_cents: null };
  const legacyLater = calculateOrderPricing(base({ pricingRules: RULES_LATER, feeWaivers: waivedTravel, existingOrder: legacy, storedSetupFeeCents: 0 }), { distanceMiles: 14.2, isSameDayWeekdayDelivery: () => false });
  if (legacyLater.status !== 'ok') throw new Error('x');
  eq('legacy waived: the editor shows the fee as waived with an UNKNOWN amount, not today\'s figure', [legacyLater.orderData.travel_fee_cents, legacyLater.orderData.waived_amount_unknown], [0, ['travel']]);
  eq('legacy waived: nothing is recorded for it (no guess is persisted)', legacyLater.calculatedPricing.waived_fee_amounts_cents, {});
  eq('legacy waived: the stored-order display says unknown too', [storedFeeAmounts(legacy).travel_fee_cents, storedFeeAmounts(legacy).waived_amount_unknown], [0, ['travel']]);
  eq('legacy waived: nothing is charged either way', legacyLater.calculatedPricing.travel_fee_cents, 0);

  // the display list marks the amount as unknown, and the screens render "Waived" without a figure
  const display = buildOrderSummaryDisplay({
    items: [], fees: { travel_fee_cents: 0, travel_fee_waived: true, waived_amount_unknown: ['travel'] }, discounts: [], customFees: [], subtotal_cents: 25000, tax_cents: 0, tip_cents: 0,
    total_cents: 25000, deposit_due_cents: 5000, deposit_paid_cents: 0, balance_due_cents: 20000,
  });
  eq('waived: the display line is flagged amount-unknown', display.fees.map((f) => [f.name.startsWith('Travel Fee'), f.amountUnknown === true]), [[true, true]]);
  const known = buildOrderSummaryDisplay({
    items: [], fees: { travel_fee_cents: wouldHaveBeen, travel_fee_waived: true }, discounts: [], customFees: [], subtotal_cents: 25000, tax_cents: 0, tip_cents: 0,
    total_cents: 25000, deposit_due_cents: 5000, deposit_paid_cents: 0, balance_due_cents: 20000,
  });
  eq('waived: a known amount is shown as an amount', known.fees.map((f) => [f.amount, f.amountUnknown === true]), [[wouldHaveBeen, false]]);

  // a fee that is NOT waived is the stored charge, whatever today's rule says
  const charged = storedFeeAmounts({ travel_fee_cents: 1050, travel_fee_waived: false, waived_fee_amounts_cents: { travel: 77 } });
  eq('not waived: the charged fee is shown (a stray kept amount is ignored)', charged.travel_fee_cents, 1050);

  // the screens
  const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  ok('OrderSummary (Admin single order, Admin Edit summary, Customer Portal) renders an unknown waived amount as "Waived" with no dollar figure', /fee\.amountUnknown && isWaived/.test(read('src/components/order/OrderSummary.tsx')));
  ok('Printable Invoice: a waived fee stored as $0 shows no dollar figure', /travelFeeWaived && priceBreakdown\.travel_fee_cents === 0/.test(read('src/components/invoice/PrintableInvoice.tsx')) && /taxWaived && priceBreakdown\.tax_cents === 0/.test(read('src/components/invoice/PrintableInvoice.tsx')));
  const summarySrc = read('src/lib/orders/orderSummaryLoader.ts') + read('src/lib/pricing/orderFeeDisplay.ts');
  ok('the stored-order display never reads pricing_rules for a waived fee', !/pricing_rules|surface_sandbag_fee_cents|same_day_pickup_fee_cents\s*\?\?|generator_price_cents/.test(read('src/lib/pricing/orderFeeDisplay.ts')) && /storedFeeAmounts\(order\)/.test(summarySrc));
}

// =====================================================================================================================
// 9d. Staff money is written by the server only
// =====================================================================================================================
{
  const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = walk('src');
  const writesTo = (table: string) => files.filter((f) => new RegExp(`from\\(['"]${table}['"]\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`).test(read(f)));
  eq('no browser code writes order discounts', writesTo('order_discounts'), []);
  eq('no browser code writes order custom fees', writesTo('order_custom_fees'), []);
  eq('no browser code writes order items', writesTo('order_items'), []);
  const guarded = ['subtotal_cents', 'travel_fee_cents', 'surface_fee_cents', 'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents', 'generator_fee_cents', 'setup_fee_cents', 'tax_cents', 'deposit_due_cents', 'balance_due_cents', 'custom_deposit_cents', 'waived_fee_amounts_cents', 'event_essentials_subtotal_cents'];
  const orderWriters = files.filter((f) => /from\(['"]orders['"]\)[\s\S]{0,200}?\.(insert|update|upsert)\(/.test(read(f)));
  const leaking = orderWriters.filter((f) => {
    const src = read(f);
    return [...src.matchAll(/from\(['"]orders['"]\)[\s\S]{0,200}?\.(insert|update|upsert)\(\s*(\{[\s\S]*?\})\s*\)/g)].some((m) => guarded.some((c) => new RegExp(`\\b${c}\\b`).test(m[2])));
  });
  eq('no browser code writes an order pricing column', leaking, []);
  ok('the editor save and the invoice creation go through the server function', /callStaffOrderSave(<[^>]*>)?\('save_changes'/.test(read('src/lib/orders/staffOrderSaveRequest.ts')) && /callStaffOrderSave<[^>]*>\('create_invoice'/.test(read('src/lib/payments/invoiceService.ts')));
  ok('the request builders never read a browser-calculated price', !/subtotal_cents|tax_cents|total_cents|deposit_due_cents|balance_due_cents/.test(read('src/lib/payments/invoiceService.ts').replace(/pricing_context[^\n]*/g, '')) && !/(subtotal|tax|total|deposit_due|balance_due)_cents\s*:/.test(read('src/lib/orders/staffOrderSaveRequest.ts')));
  for (const f of ['src/components/admin/invoices/InvoiceBuilder.tsx', 'src/components/crew/CrewInvoiceBuilder.tsx']) {
    const src = read(f);
    const start = src.indexOf('generateInvoice(');
    const end = src.slice(start).search(/\n\s+customer\n/);
    const call = src.slice(start, start + (end > 0 ? end : 3000));
    ok(`${f}: the invoice call sends no browser-calculated price (no priceBreakdown, subtotal, tax, total, deposit required, fee amount)`, start > 0 && !/\bpriceBreakdown\s*:|\bsubtotal\s*:|taxCents|totalCents|depositRequired|setupFeeCents|generatorFeeCents/.test(call));
  }
  ok('send-invoice takes the deposit from the stored order, not from the request', !/depositCents:\s*raw/.test(read('supabase/functions/send-invoice/index.ts')) && /order\.deposit_due_cents/.test(read('supabase/functions/send-invoice/index.ts')));
  ok('the staff-order-save function is staff-only (no customer, no anon, no service identity authors a save)', /requireRoles\(caller, action === "save_changes" \? STAFF_ADMIN_ROLES : INVOICE_SENDER_ROLES/.test(read('supabase/functions/staff-order-save/index.ts')));
  ok('the server module refuses unknown request fields (a price is one)', /unknown field/.test(read('supabase/functions/_shared/orders/staff-order-save.ts')));
}

// =====================================================================================================================
// 10. One formula per concept: no screen or function does its own money arithmetic
// =====================================================================================================================
{
  const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = [...walk('src'), ...walk('supabase/functions')].filter((f) => !/\.test\.|database\.types|orderMoney\.ts$|routeOptimization|calculate-route-mileage|node_modules/.test(f));
  const taxLiteral = files.filter((f) => /\*\s*0\.06|0\.06\s*\*|=\s*0\.06\b|taxRate\s*=\s*0\.06/.test(read(f)));
  eq('the 6% rate is written in exactly one place (orderMoney)', taxLiteral, []);
  const moneyRead = read('src/lib/pricing/orderMoney.ts');
  ok('orderMoney is the one place that names the rate', /export const SALES_TAX_RATE = 0\.06/.test(moneyRead));
  const percentDiscountMath = files.filter((f) => /percentage\s*\/\s*100/.test(read(f)) && !/orderMoney|pricingRules|PricingRulesTab|AdminSettings|settings|\.test\./i.test(f));
  eq('no discount is computed outside orderMoney', percentDiscountMath.map((f) => f.replace(/\\/g, '/')), []);
  ok('the receipts and Edge Functions use the generated orderMoney copy, not their own total arithmetic', ['supabase/functions/_shared/payments/receipt-order-totals.ts', 'supabase/functions/_shared/portal/portal-actions.ts', 'supabase/functions/order-lifecycle/index.ts', 'supabase/functions/send-invoice/index.ts'].every((f) => /orderMoney/.test(read(f))));
  ok('a blank deposit-override field is not a zero deposit', !/onApply\(0\)/.test(read('src/components/order-detail/DepositOverride.tsx')) && !/customDepositInput \|\| '0'/.test(read('src/hooks/orders/useDepositOverride.ts')));
}

// ---------------------------------------------------------------------------------------------------------------------
// Authority scan: no browser code writes a financial table or a pricing column, and the server owns the travel distance
// ---------------------------------------------------------------------------------------------------------------------
{
  // Full-line comments only (a "//" or "/*" inside a string or a URL must not swallow code).
  const strip = (t: string) => t.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const browserFiles = walk('src').filter((f) => !/\.test\.|database\.types|Scenarios\.ts$/.test(f));
  const FINANCIAL_TABLES = ['orders', 'order_items', 'order_discounts', 'order_custom_fees', 'payments', 'order_refunds'];
  // Every column that carries money, a money input's snapshot, or a payment ledger amount on `orders`.
  const MONEY_COLUMNS = [
    'subtotal_cents', 'event_essentials_subtotal_cents', 'travel_fee_cents', 'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents',
    'travel_is_flat_fee', 'surface_fee_cents', 'same_day_pickup_fee_cents', 'same_day_weekday_delivery_fee_cents', 'generator_fee_cents', 'setup_fee_cents', 'tax_cents',
    'deposit_due_cents', 'balance_due_cents', 'custom_deposit_cents', 'waived_fee_amounts_cents', 'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason',
    'surface_fee_waived', 'surface_fee_waive_reason', 'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',
    'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'deposit_paid_cents', 'balance_paid_cents', 'tip_cents', 'damage_charged_cents', 'total_refunded_cents', 'stripe_payment_status', 'payment_lock',
  ];
  const matchingParen = (text: string, open: number): number => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) return i;
    }
    return text.length;
  };
  const writes: Array<{ file: string; table: string; op: string; keys: string[] }> = [];
  for (const f of browserFiles) {
    const text = strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
    for (const table of FINANCIAL_TABLES) {
      const re = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const chain = text.slice(m.index, text.indexOf(';', m.index) < 0 ? undefined : text.indexOf(';', m.index));
        const op = /\.(insert|upsert|delete|update)\s*\(/.exec(chain);
        if (!op) continue;
        let keys: string[] = [];
        if (op[1] === 'update' || op[1] === 'insert' || op[1] === 'upsert') {
          const open = m.index + (op.index ?? 0) + op[0].length - 1;
          const arg = text.slice(open + 1, matchingParen(text, open));
          if (/^\s*\{/.test(arg)) keys = [...arg.matchAll(/(?:^|[{,\s])([a-z_]+)\s*(?::|,|\})/g)].map((k) => k[1]);
          else {
            const id = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(arg)?.[1];
            if (id) {
              const init = new RegExp(`(?:const|let)\\s+${id}\\b[^=]*=\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? '';
              keys = [...init.matchAll(/([a-z_]+)\s*[:,]/g)].map((k) => k[1]);
              keys.push(...[...text.matchAll(new RegExp(`${id}\\.([a-z_]+)\\s*=`, 'g'))].map((k) => k[1]));
              if (/^\s*\{\s*\.\.\./.test(init)) keys.push('<spread>');
            } else keys = ['<unanalysable>'];
          }
        }
        writes.push({ file: f.replace(/\\/g, '/'), table, op: op[1], keys });
      }
    }
  }
  if ((globalThis as any).process?.env?.PRINT_AUTHORITY_MAP) console.log(writes.map((w) => w.op + ' ' + w.table + ' ' + w.file + ' [' + w.keys.join(',') + ']').join('\n'));
  const ops = (op: string) => writes.filter((w) => w.op === op);
  eq('AUTHORITY SCAN: no browser code INSERTs, upserts or DELETEs a row of orders / order_items / order_discounts / order_custom_fees', writes.filter((w) => w.op !== 'update'), []);
  eq('AUTHORITY SCAN: the only table a browser file still UPDATEs is orders (never a financial child table)', [...new Set(ops('update').map((w) => w.table))], ['orders']);
  eq('AUTHORITY SCAN: no browser UPDATE of orders names a pricing, travel, waiver or payment-ledger column', ops('update').filter((w) => w.keys.some((k) => MONEY_COLUMNS.includes(k) || k === '<spread>' || k === '<unanalysable>')), []);
  ok('AUTHORITY SCAN: the update scan found the known non-financial workflow writes (status / workflow / lot pictures / cancellation)', ops('update').length >= 6 && ops('update').every((w) => w.keys.length > 0));
  eq('AUTHORITY SCAN: no browser file calls the server-only save functions directly', browserFiles.filter((f) => /rpc\(\s*['"`](apply_staff_order_save|create_staff_invoice_order)/.test(fs.readFileSync(f, 'utf8'))), []);
  ok('AUTHORITY SCAN: the order modal and the summary loader no longer persist computed miles', !/\.update\(\{ travel_total_miles/.test(fs.readFileSync('src/components/admin/orders/OrderDetailModal.tsx', 'utf8')) && !/\.update\(\{ travel_total_miles/.test(fs.readFileSync('src/lib/orders/orderSummaryLoader.ts', 'utf8')));

  // The browser does not send a distance or a capability, and the server never reads one
  const server = fs.readFileSync('supabase/functions/_shared/orders/staff-order-save.ts', 'utf8');
  const indexFn = fs.readFileSync('supabase/functions/staff-order-save/index.ts', 'utf8');
  eq('DISTANCE AUTHORITY: no source (browser or server) mentions measuredDistanceMiles any more', [...browserFiles, ...walk('supabase/functions')].filter((f) => !/\.test\./.test(f) && /measuredDistanceMiles/.test(fs.readFileSync(f, 'utf8'))), []);
  ok('DISTANCE AUTHORITY: the server measures with the Google Distance Matrix and fails closed when it cannot', /distancematrix\/json/.test(server) && /DISTANCE_UNAVAILABLE/.test(server) && !/DISTANCE_REQUIRED/.test(server));
  ok('DISTANCE AUTHORITY: the lookup sends the address text and the shop origin, not browser coordinates', /destinations=\$\{encodeURIComponent\(destination\)\}/.test(server) && /origins=\$\{encodeURIComponent\(`\$\{HOME_BASE\.lat\},\$\{HOME_BASE\.lng\}`\)\}/.test(server));
  ok('DISTANCE AUTHORITY: it uses the secret calculate-route-mileage already uses (no new key)', /GOOGLE_MAPS_API_KEY/.test(server) && /GOOGLE_MAPS_API_KEY/.test(fs.readFileSync('supabase/functions/calculate-route-mileage/index.ts', 'utf8')));
  ok('DISTANCE AUTHORITY: browser coordinates never reach the pricing engine call', !/lat: edited\.address_lat/.test(server) && !/lat: parsedEvent\.address_lat/.test(server));
  ok('CAPABILITY: the override capability is derived from the verified caller in the Edge Function and is not a body field', /const deps = \{[^}]*canOverridePricing: isStaffAdmin\(caller\) \};/.test(indexFn) && (indexFn.match(/canOverridePricing/g) || []).length === 1 && !/canOverridePricing/.test(server.slice(server.indexOf('const SAVE_KEYS'), server.indexOf('const SAVE_KEYS') + 400)) && !/canOverridePricing/.test(server.slice(server.indexOf('const INVOICE_KEYS'), server.indexOf('const INVOICE_KEYS') + 400)));
  ok('CAPABILITY: the module defaults to deny', /deps\.canOverridePricing === true/.test(server) && /const canOverride = deps\.canOverridePricing === true;/.test(server));

  // The stale-save state covers the waivers, their reasons, the waived amounts and the whole travel snapshot
  const stateSrc = fs.readFileSync('src/lib/pricing/orderPricingState.ts', 'utf8');
  const stateCols = (/PRICING_STATE_COLUMNS = \[([\s\S]*?)\] as const/.exec(stateSrc)?.[1] ?? '').match(/'[a-z_]+'/g)?.map((c) => c.slice(1, -1)) ?? [];
  const REQUIRED_STATE = [
    'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason', 'generator_fee_waived', 'generator_fee_waive_reason',
    'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason', 'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',
    'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',
  ];
  eq('STALE STATE: every waiver flag / reason, the waived amounts and the travel snapshot are part of the compared state', REQUIRED_STATE.filter((c) => !stateCols.includes(c)), []);
  eq('STALE STATE: every money column of orders is in the compared state or is a payment ledger column covered by its own guard', MONEY_COLUMNS.filter((c) => !stateCols.includes(c) && !['deposit_paid_cents', 'balance_paid_cents', 'tip_cents', 'damage_charged_cents', 'total_refunded_cents', 'stripe_payment_status', 'payment_lock'].includes(c)), []);
  ok('STALE STATE: the server-side copy is the generated one (no separate list)', fs.readFileSync('supabase/functions/_shared/booking/orderPricingState.ts', 'utf8').includes("'travel_is_flat_fee'"));

  // The database guard names every money column (the source scan and the database capability agree)
  const mig = fs.readFileSync('supabase/migrations/20261021120000_server_authoritative_order_pricing_saves.sql', 'utf8');
  // The guard's latest definition (the refund-safety migration restates it with the payment-state flags added).
  const mig4 = fs.readFileSync('supabase/migrations/20261022120000_refund_safety_and_financial_write_authority.sql', 'utf8');
  const guardBody = /FUNCTION public\.guard_order_pricing_authority\(\)[\s\S]*?\$\$;/.exec(mig4)?.[0] ?? '';
  eq('DATABASE GUARD: every money column is checked on UPDATE by the pricing-authority trigger', MONEY_COLUMNS.filter((c) => !new RegExp(`NEW\\.${c} IS DISTINCT FROM OLD\\.${c}`).test(guardBody)), []);
  for (const t of ['order_items', 'order_discounts', 'order_custom_fees']) ok(`DATABASE GUARD: INSERT, UPDATE and DELETE on ${t} are revoked from authenticated and anon`, new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${t} FROM authenticated, anon;`).test(mig));
  ok('DATABASE GUARD: INSERT and DELETE on orders are revoked from authenticated and anon (orders are created by the server functions)', /REVOKE INSERT, DELETE ON public\.orders FROM authenticated, anon;/.test(mig));
  ok('DATABASE GUARD: the Crew draft-order and child INSERT policies are dropped and no write policy is created', /DROP POLICY IF EXISTS "Crew create draft orders"/.test(mig) && /DROP POLICY IF EXISTS "Crew create order items"/.test(mig) && /DROP POLICY IF EXISTS "Admin and master manage order items"/.test(mig) && !/CREATE POLICY[^;]*FOR (ALL|INSERT|UPDATE|DELETE)/.test(mig));
  ok('DATABASE GUARD: the stale check compares the waived amounts exactly, not by containment', /\? 'waived_fee_amounts_cents'[\s\S]{0,200}IS DISTINCT FROM/.test(mig));
}

// ---------------------------------------------------------------------------------------------------------------------
// The compared state of an order (stale-save detection), pure
// ---------------------------------------------------------------------------------------------------------------------
{
  const base = {
    status: 'pending_review', subtotal_cents: 25000, travel_fee_cents: 1000, travel_total_miles: '14.20', travel_base_radius_miles: 10, travel_chargeable_miles: 4.2, travel_per_mile_cents: 250,
    travel_is_flat_fee: false, tax_waived: false, tax_waive_reason: null, travel_fee_waived: false, travel_fee_waive_reason: null, surface_fee_waived: false, surface_fee_waive_reason: null, generator_fee_waived: false, generator_fee_waive_reason: null,
    same_day_pickup_fee_waived: false, same_day_pickup_fee_waive_reason: null, same_day_weekday_delivery_fee_waived: false, same_day_weekday_delivery_fee_waive_reason: null, waived_fee_amounts_cents: { travel: 1000, surface: 3500 },
    event_date: '2030-06-01T00:00:00', event_end_date: '2030-06-01', address_id: 'a',
  };
  const items = [{ id: '1', qty: 1, unit_price_cents: 25000 }];
  const state = (o: any) => orderPricingState(o, items, [], []);
  const same = (a: any, b: any) => sameOrderPricingState(state(a), state(b));
  ok('state: a numeric column is the same number whether the browser sees a string or a number', same(base, { ...base, travel_total_miles: 14.2 }));
  ok('state: waived amounts compare equal whatever their key order', same(base, { ...base, waived_fee_amounts_cents: { surface: 3500, travel: 1000 } }));
  ok('state: a dated column compares by its day', same(base, { ...base, event_date: '2030-06-01' }));
  const differs: Array<[string, Record<string, unknown>]> = [
    ['a waiver flag', { tax_waived: true }], ['a waiver reason', { travel_fee_waive_reason: 'goodwill' }], ['another waived flag', { travel_fee_waived: true }],
    ['a waived amount value', { waived_fee_amounts_cents: { travel: 999, surface: 3500 } }], ['a waived amount added', { waived_fee_amounts_cents: { travel: 1000, surface: 3500, generator: 1 } }],
    ['waived amounts removed', { waived_fee_amounts_cents: null }], ['the travel miles', { travel_total_miles: '99' }], ['the base radius', { travel_base_radius_miles: 3 }],
    ['the chargeable miles', { travel_chargeable_miles: 77 }], ['the per-mile rate', { travel_per_mile_cents: 999 }], ['the flat-fee flag', { travel_is_flat_fee: true }],
    ['the subtotal', { subtotal_cents: 1 }], ['the status', { status: 'confirmed' }],
    ['the travel waiver reason (set)', { travel_fee_waive_reason: 'x' }], ['the surface waiver flag', { surface_fee_waived: true }], ['the surface waiver reason', { surface_fee_waive_reason: 'x' }],
    ['the generator waiver flag', { generator_fee_waived: true }], ['the generator waiver reason', { generator_fee_waive_reason: 'x' }], ['the pickup waiver flag', { same_day_pickup_fee_waived: true }],
    ['the pickup waiver reason', { same_day_pickup_fee_waive_reason: 'x' }], ['the weekday waiver flag', { same_day_weekday_delivery_fee_waived: true }], ['the weekday waiver reason', { same_day_weekday_delivery_fee_waive_reason: 'x' }],
    ['the tax waiver reason', { tax_waive_reason: 'x' }],
  ];
  for (const [label, change] of differs) ok(`state: ${label} makes an older view stale`, !same(base, { ...base, ...change }));
  ok('state: a column the browser copy does not carry is simply not compared', sameOrderPricingState(orderPricingState({ status: 'pending_review' }, items, [], []), state(base)));
  ok('state: the children are compared exactly', !sameOrderPricingState(state(base), orderPricingState(base, [{ id: '1', qty: 2, unit_price_cents: 25000 }], [], [])));
}

console.log(`Pricing reconciliation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} pricing reconciliation test(s) failed`);
