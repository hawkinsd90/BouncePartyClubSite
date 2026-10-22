// The server boundary for staff pricing saves: Admin Edit (save_changes) and Admin / Crew Invoice creation (create_invoice), run
// through the REAL Edge Function source and the REAL server module against a scratch PostgreSQL database (see paymentHarness.ts).
//
// What is proved:
//   - nothing the browser calculated can set a price: a request carrying a price is refused, and a "debug" copy of the browser's
//     own totals is ignored - the persisted money is always the server's;
//   - an existing order is a pricing SNAPSHOT: a pricing_rules change alone, or a note-only edit, changes no money;
//   - a stale save never overwrites newer pricing (checked by the server and again, under the row lock, by the database);
//   - only the right roles can save; a payment in flight blocks a pricing save;
//   - the amounts of waived fees are kept, never rebuilt from today's rules.
//
// With no reachable scratch database the file is SKIPPED (ROLE_DB_REQUIRE=1 makes that a failure).
// Run: node node_modules/jiti/bin/jiti.js src/lib/staffOrderSave.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const process: { env: Record<string, string | undefined> };

import * as authHelpers from '../../../../supabase/functions/_shared/auth';
import * as staffSave from '../../../../supabase/functions/_shared/orders/staff-order-save';
import { PgPool, PG_TABLES, ensurePayDatabase, makeWorld, loadHandler, callHandler, lit, SERVICE_KEY, type World } from '../support/paymentHarness';
import { calculateOrderPricing } from '../../pricing/orderPricingCalculation';
import { orderPricingState } from '../../pricing/orderPricingState';
import { storedFeeAmounts } from '../../pricing/orderFeeDisplay';
import { storedOrderTotalCents } from '../../pricing/orderMoney';
import { calculatePrice, isSameDayWeekdayDelivery } from '../../pricing';
import type { PricingRules } from '../../pricing';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function eq(label: string, a: unknown, b: unknown) {
  ok(`${label} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
}

const TAG = String((Date.now() % 1e6) * 1000 + (process as any).pid % 1000).padStart(9, '0');
const U1 = `dddddddd-1111-4000-8000-${TAG}001`;
const U2 = `dddddddd-1111-4000-8000-${TAG}002`;
const STREET = `${TAG} Test Street`;

const RULES: PricingRules & Record<string, unknown> = {
  id: `dddddddd-2222-4000-8000-${TAG}001`,
  base_radius_miles: 10, included_city_list_json: ['Plymouth'], per_mile_after_base_cents: 250, zone_overrides_json: [], surface_sandbag_fee_cents: 3500,
  residential_multiplier: 1, commercial_multiplier: 1.25, overnight_holiday_only: false, extra_day_pct: 50, generator_price_cents: 10000, deposit_per_unit_cents: 5000,
  same_day_pickup_fee_cents: 10500, generator_fee_single_cents: 10000, generator_fee_multiple_cents: 7500, apply_taxes_by_default: true,
  same_day_weekday_delivery_fee_cents: 2500, same_day_matrix_json: null, ee_only_deposit_base_threshold_cents: 20000, ee_only_deposit_base_cents: 5000,
  ee_only_deposit_subtotal_step_cents: 10000, ee_only_deposit_step_cents: 5000, event_essentials_setup_minimum_cents: 15000,
} as any;
const RULES_LATER = { ...RULES, surface_sandbag_fee_cents: 5000, residential_multiplier: 1.2, extra_day_pct: 75, same_day_pickup_fee_cents: 15000, per_mile_after_base_cents: 400, deposit_per_unit_cents: 7500, apply_taxes_by_default: false };

(async () => {
  const db = ensurePayDatabase();
  if (!db) {
    if (process.env.ROLE_DB_REQUIRE) ok('executed: the scratch database is available (ROLE_DB_REQUIRE is set)', false);
    else console.log('Staff order save tests SKIPPED: the scratch database was not reachable.');
    finish();
    return;
  }
  const pg = new PgPool(db.psql, db.db, 6);
  const createdOrders: string[] = [];

  await pg.exec(`INSERT INTO public.units (id, slug, name, price_dry_cents, dimensions, footprint_sqft, capacity, types, active) VALUES
    ('${U1}', 'u-${TAG}-1', 'Test Castle ${TAG}', 25000, '10x10', 100, 10, ARRAY['bounce'], true),
    ('${U2}', 'u-${TAG}-2', 'Test Slide ${TAG}', 31250, '10x20', 200, 12, ARRAY['slide'], true);`);

  // The change log keeps the staff member's id, which must be a real user.
  for (const k of ['a01', 'a02', 'a03', 'a04']) {
    await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-0000-4000-8000-${TAG}${k}', 'staff-${TAG}-${k}@example.test') ON CONFLICT DO NOTHING;`);
  }

  const newWorld = (rules: any = RULES): World => {
    const w = makeWorld(pg);
    w.pgTables = new Set([...PG_TABLES, 'order_items', 'order_discounts', 'order_custom_fees', 'addresses']);
    w.tables.pricing_rules = [{ ...rules }];
    w.tables.units = [
      { id: U1, name: `Test Castle ${TAG}`, price_dry_cents: 25000, price_water_cents: 30000, active: true },
      { id: U2, name: `Test Slide ${TAG}`, price_dry_cents: 31250, price_water_cents: null, active: true },
    ];
    // Real user ids (uuids), as the database stores them.
    const uid = (k: string) => `aaaaaaaa-0000-4000-8000-${TAG}${k}`;
    w.users = { 'jwt-master': uid('a01'), 'jwt-admin': uid('a02'), 'jwt-crew': uid('a03'), 'jwt-cust': uid('a04') };
    w.tables.user_roles = [{ user_id: uid('a01'), role: 'master' }, { user_id: uid('a02'), role: 'admin' }, { user_id: uid('a03'), role: 'crew' }, { user_id: uid('a04'), role: 'customer' }];
    w.tables.inventory_products = [];
    w.tables.product_pricing = [];
    w.tables.product_categories = [];
    w.tables.product_bundles = [];
    return w;
  };
  // The shop-to-address distance is measured on the server (Google Distance Matrix). The tests inject a deterministic measurer; the
  // production wiring (no injection: the Google lookup keyed by GOOGLE_MAPS_API_KEY) is exercised separately below.
  const distanceCalls: string[] = [];
  let distanceFor: (destination: string) => number | null = () => 14.2;
  const fakeMeasure = async (destination: string) => { distanceCalls.push(destination); return distanceFor(destination); };
  const withFake = (fn: any) => (deps: any, raw: any) => fn({ ...deps, drivingMiles: fakeMeasure }, raw);
  const shared = { ...authHelpers, ...staffSave, saveStaffOrderChanges: withFake(staffSave.saveStaffOrderChanges), createStaffInvoiceOrder: withFake(staffSave.createStaffInvoiceOrder) };
  const sharedProduction = { ...authHelpers, ...staffSave };
  const handler = (w: World) => loadHandler('staff-order-save', w, shared);
  const call = (w: World, body: Record<string, unknown>, bearer: string | null = 'jwt-admin') => callHandler(handler(w), body, bearer);

  const eventBase = (over: Record<string, unknown> = {}) => ({
    event_date: '2030-06-01', event_end_date: '2030-06-01', start_window: '10:00', end_window: '12:00', until_end_of_day: false, location_type: 'residential', surface: 'grass',
    generator_qty: 0, pickup_preference: 'next_day', same_day_responsibility_accepted: false, overnight_responsibility_accepted: false,
    address_line1: STREET, address_line2: '', city: 'Detroit', state: 'MI', zip: '48201', lat: 42.3, lng: -83.36, ...over,
  });
  const invoiceBody = (over: Record<string, unknown> = {}) => ({
    action: 'create_invoice', customerId: null, items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 1 }], eventDetails: eventBase(), discounts: [], customFees: [],
    waivers: {}, customDepositCents: null, customSetupFeeCents: null, adminMessage: '', requireCardOnFile: true, ...over,
  });

  const orderRow = async (id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.orders t WHERE id = '${id}'`))[0]?.j;
  const rowsOf = async (table: string, id: string) => (await pg.query(`SELECT to_jsonb(t) AS j FROM public.${table} t WHERE order_id = '${id}' ORDER BY id`)).map((r: any) => r.j);
  const moneyOf = (o: any) => ({ subtotal: o.subtotal_cents, travel: o.travel_fee_cents, surface: o.surface_fee_cents, pickup: o.same_day_pickup_fee_cents, weekday: o.same_day_weekday_delivery_fee_cents, generator: o.generator_fee_cents, setup: o.setup_fee_cents, tax: o.tax_cents, deposit: o.deposit_due_cents, balance: o.balance_due_cents, custom: o.custom_deposit_cents });
  const orderCount = async () => Number((await pg.query(`SELECT count(*)::text AS j FROM public.orders t WHERE t.address_id IN (SELECT id FROM public.addresses WHERE line1 LIKE '${TAG}%')`))[0].j);
  const loadState = async (id: string) => {
    const o = await orderRow(id);
    return orderPricingState(o, (await rowsOf('order_items', id)), (await rowsOf('order_discounts', id)), (await rowsOf('order_custom_fees', id)));
  };
  const createOrder = async (w: World, over: Record<string, unknown> = {}, bearer = 'jwt-admin'): Promise<string> => {
    const r = await call(w, invoiceBody(over), bearer);
    if (r.status !== 200) throw new Error('setup: create failed ' + JSON.stringify(r.json));
    const id = r.json.orderId as string;
    createdOrders.push(id);
    await pg.exec(`UPDATE public.orders SET status = 'pending_review' WHERE id = '${id}';`);
    return id;
  };
  const editBody = async (id: string, over: Record<string, unknown> = {}) => {
    const o = await orderRow(id);
    const a = (await pg.query(`SELECT to_jsonb(t) AS j FROM public.addresses t WHERE id = '${o.address_id}'`))[0].j;
    const items = (await rowsOf('order_items', id)).map((i: any) => ({ id: i.id, kind: 'inflatable', qty: i.qty, is_deleted: false, is_updated: false }));
    return {
      action: 'save_changes', orderId: id, expectedState: await loadState(id),
      edited: { location_type: o.location_type, surface: o.surface ?? 'grass', generator_qty: o.generator_qty ?? 0, start_window: o.start_window, end_window: o.end_window, event_date: o.event_date, event_end_date: o.event_end_date, pickup_preference: o.pickup_preference, address_line1: a.line1, address_line2: '', address_city: a.city, address_state: a.state, address_zip: a.zip, address_lat: a.lat, address_lng: a.lng },
      items, discounts: [], customFees: [], waivers: {}, customDepositCents: null, customSetupFeeCents: null, adminMessage: '', adminOverrideApproval: false, requireCardOnFile: true,
      ...over,
    };
  };

  // What the engine says for the booked order (the independent expectation: the same pure engine the Quote and the editor use).
  const expectedForNew = (rules: any, items: Array<{ unit_id: string; qty: number; price: number }>, over: Record<string, any> = {}, dist = 14.2) => {
    const r = calculateOrderPricing({
      items: items.map((i) => ({ unit_id: i.unit_id, unit_name: 'x', qty: i.qty, wet_or_dry: 'dry' as const, unit_price_cents: i.price })), eeProductItems: [],
      eventDetails: { event_date: '2030-06-01', event_end_date: '2030-06-01', location_type: 'residential', surface: 'grass', pickup_preference: 'next_day', generator_qty: 0, address_line1: STREET, address_city: 'Detroit', address_state: 'MI', address_zip: '48201' },
      discounts: [], customFees: [], customDepositCents: null, customSetupFeeCents: null, pricingRules: rules, feeWaivers: {}, ...over,
    } as any, { distanceMiles: dist, isSameDayWeekdayDelivery });
    if (r.status !== 'ok') throw new Error('engine');
    return r.calculatedPricing;
  };
  void calculatePrice;

  // =================================================================================================================
  // 1. Creating an invoice: the server prices it
  // =================================================================================================================
  {
    const w = newWorld();
    const before = await orderCount();
    const r = await call(w, invoiceBody());
    ok('create_invoice: Admin creates an invoice', r.status === 200 && r.json?.success === true && typeof r.json?.orderId === 'string');
    const id = r.json.orderId as string;
    createdOrders.push(id);
    const o = await orderRow(id);
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }]);
    eq('create_invoice: the persisted money is exactly the engine\'s (subtotal, travel, surface, pickup, weekday, generator, setup, tax, deposit, balance)', moneyOf(o),
      { subtotal: exp.subtotal_cents, travel: exp.travel_fee_cents, surface: exp.surface_fee_cents, pickup: exp.same_day_pickup_fee_cents, weekday: exp.same_day_weekday_delivery_fee_cents, generator: exp.generator_fee_cents, setup: exp.setup_fee_cents, tax: exp.tax_cents, deposit: exp.deposit_due_cents, balance: exp.balance_due_cents, custom: null });
    ok('create_invoice: it is a draft, with the item at the catalog price', o.status === 'draft' && (await rowsOf('order_items', id))[0]?.unit_price_cents === 25000);
    eq('create_invoice: one order was added', (await orderCount()) - before, 1);
    eq('create_invoice: the response total is the stored total', r.json?.pricing?.total_cents, storedOrderTotalCents(o, [], []));
  }

  // The browser's own arithmetic is not an input
  for (const [label, extra] of [
    ['subtotal', { subtotal_cents: 1 }], ['tax', { tax_cents: 0 }], ['total', { total_cents: 1 }], ['deposit', { deposit_due_cents: 0 }], ['balance', { balance_due_cents: 0 }],
    ['travel fee', { travel_fee_cents: 0 }], ['surface fee', { surface_fee_cents: -500 }], ['a duplicated weekday fee', { same_day_weekday_delivery_fee_cents: 5000 }],
    ['the setup fee', { setup_fee_cents: 0 }], ['a price breakdown', { priceBreakdown: { total_cents: 1 } }], ['depositRequired', { depositRequired: 0 }], ['a huge subtotal', { subtotal: 999999999 }],
  ] as Array<[string, Record<string, unknown>]>) {
    const w = newWorld();
    const before = await orderCount();
    const r = await call(w, invoiceBody(extra));
    ok(`create_invoice tamper (${label}): refused, nothing created`, r.status === 400 && (await orderCount()) === before);
  }
  {
    // an allowed "debug copy" of the browser's totals is ignored
    const w = newWorld();
    const r = await call(w, invoiceBody({ clientPricing: { subtotal_cents: 1, tax_cents: 0, total_cents: 1, deposit_due_cents: 0, balance_due_cents: 0 } }));
    const id = r.json.orderId as string;
    createdOrders.push(id);
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }]);
    eq('create_invoice: a comparison copy of the browser\'s totals (1 / 0 / 1 / 0 / 0) changes nothing - the canonical values are persisted', [(await orderRow(id)).subtotal_cents, (await orderRow(id)).deposit_due_cents], [exp.subtotal_cents, exp.deposit_due_cents]);
  }
  {
    // item identity and prices come from the catalog; a staff line price is an explicit, bounded input
    const w = newWorld();
    const r = await call(w, invoiceBody({ items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 2, unit_price_cents: 20000 }] }));
    ok('create_invoice: a staff line price (adjusted price) is accepted', r.status === 200);
    createdOrders.push(r.json.orderId);
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 2, price: 20000 }]);
    eq('create_invoice: ...and the subtotal is derived from it (2 x 20000), not supplied', (await orderRow(r.json.orderId)).subtotal_cents, exp.subtotal_cents);
    for (const [label, price] of [['negative', -5], ['fractional', 12.5], ['NaN as a string', 'abc'], ['absurdly large', 99999999999]] as Array<[string, unknown]>) {
      const bad = await call(w, invoiceBody({ items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 1, unit_price_cents: price }] }));
      ok(`create_invoice: a ${label} line price is refused`, bad.status === 400);
    }
    const unknownUnit = await call(w, invoiceBody({ items: [{ kind: 'inflatable', unit_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', wet_or_dry: 'dry', qty: 1 }] }));
    ok('create_invoice: an unknown unit is refused', unknownUnit.status === 409);
    const noItems = await call(w, invoiceBody({ items: [] }));
    ok('create_invoice: an invoice with no items is refused', noItems.status === 400);
  }
  {
    // discounts, custom fees, waivers, an explicit deposit override
    const w = newWorld();
    const r = await call(w, invoiceBody({ discounts: [{ name: 'Promo', amount_cents: 1000, percentage: 20 }], customFees: [{ name: 'Help', amount_cents: 2000 }], customDepositCents: 0, waivers: { travel: { waived: true, reason: 'goodwill' } } }));
    ok('create_invoice: discounts, custom fees, a waiver and an explicit zero deposit are accepted', r.status === 200);
    const id = r.json.orderId as string;
    createdOrders.push(id);
    const o = await orderRow(id);
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }], { discounts: [{ name: 'Promo', amount_cents: 1000, percentage: 20 }], customFees: [{ name: 'Help', amount_cents: 2000 }], customDepositCents: 0, feeWaivers: { travelFeeWaived: true } });
    eq('create_invoice: the engine\'s money (fixed discount wins, fee added, zero deposit, travel waived)', [o.subtotal_cents, o.tax_cents, o.deposit_due_cents, o.balance_due_cents, o.travel_fee_cents, o.custom_deposit_cents], [exp.subtotal_cents, exp.tax_cents, exp.deposit_due_cents, exp.balance_due_cents, 0, 0]);
    ok('create_invoice: the amount the waived travel fee would have been is kept', o.waived_fee_amounts_cents?.travel === exp.waived_fee_amounts_cents.travel && (exp.waived_fee_amounts_cents.travel ?? 0) > 0);
    ok('create_invoice: the discount and fee rows were written', (await rowsOf('order_discounts', id)).length === 1 && (await rowsOf('order_custom_fees', id)).length === 1);
    const bad = await call(w, invoiceBody({ customFees: [{ name: 'Hidden discount', amount_cents: -500 }] }));
    ok('create_invoice: a negative custom fee (a hidden discount) is refused', bad.status === 400);
    const badPct = await call(w, invoiceBody({ discounts: [{ name: 'Too much', percentage: 150 }] }));
    ok('create_invoice: a discount over 100% is refused', badPct.status === 400);
    const noReason = await call(w, invoiceBody({ waivers: { same_day_weekday_delivery: { waived: true, reason: '' } } }));
    ok('create_invoice: waiving the weekday delivery fee needs a reason', noReason.status === 400 && noReason.json?.code === 'WAIVER_REASON_REQUIRED');
  }

  // =================================================================================================================
  // 2. Who may save
  // =================================================================================================================
  {
    const w = newWorld();
    const id = await createOrder(w);
    const before = await orderRow(id);
    for (const [label, bearer, status] of [['anonymous', null, 401], ['the public anon key', 'anon-key-0123456789abcdef', 401], ['a customer', 'jwt-cust', 403], ['Crew', 'jwt-crew', 403], ['the service role (not a person)', SERVICE_KEY, 403]] as Array<[string, string | null, number]>) {
      const r = await call(w, await editBody(id, { adminMessage: 'x' }), bearer);
      ok(`save_changes: ${label} is refused (${status})`, r.status === status);
    }
    eq('save_changes: ...and the order is untouched', await orderRow(id), before);
    const okAdmin = await call(w, await editBody(id, { adminMessage: 'by admin' }), 'jwt-admin');
    const okMaster = await call(w, await editBody(id, { adminMessage: 'by master' }), 'jwt-master');
    ok('save_changes: Admin and Master may save', okAdmin.status === 200 && okMaster.status === 200);

    const before2 = await orderCount();
    for (const [label, bearer, status] of [['anonymous', null, 401], ['a customer', 'jwt-cust', 403], ['the service role', SERVICE_KEY, 403]] as Array<[string, string | null, number]>) {
      const r = await call(w, invoiceBody(), bearer);
      ok(`create_invoice: ${label} is refused (${status})`, r.status === status);
    }
    eq('create_invoice: ...and nothing was created', await orderCount(), before2);
    const crew = await call(w, invoiceBody(), 'jwt-crew');
    ok('create_invoice: Crew may create an invoice (its existing capability) - and the server prices it', crew.status === 200);
    createdOrders.push(crew.json.orderId);
    const crewTamper = await call(w, invoiceBody({ subtotal_cents: 1 }), 'jwt-crew');
    ok('create_invoice: Crew cannot set a price either', crewTamper.status === 400);
    const unknownAction = await callHandler(handler(w), { action: 'delete_order', orderId: id }, 'jwt-admin');
    ok('an unknown action is refused', unknownAction.status === 400);
  }

  // =================================================================================================================
  // 3. Admin Edit: the server derives the saved money
  // =================================================================================================================
  {
    // a note-only edit after pricing_rules moved: no money changes (the snapshot)
    const w = newWorld(RULES);
    const id = await createOrder(w, { items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 2 }], eventDetails: eventBase({ surface: 'cement', pickup_preference: 'same_day', location_type: 'commercial', event_end_date: '2030-06-02' }) });
    const before = moneyOf(await orderRow(id));
    w.tables.pricing_rules = [{ ...RULES_LATER }];
    const r = await call(w, await editBody(id, { adminMessage: 'Gate code 1234' }));
    ok('edit: a note-only edit saves', r.status === 200 && r.json?.saved === true);
    eq('edit: ...after every pricing rule changed, NO money changed (subtotal, fees, tax, deposit, balance)', moneyOf(await orderRow(id)), before);
    eq('edit: ...and only the message changed', (await orderRow(id)).admin_message, 'Gate code 1234');
    ok('edit: ...and the change was logged by the server under the staff member', (await rowsOf('order_changelog', id)).some((l: any) => l.field_changed === 'admin_message' && l.user_id === `aaaaaaaa-0000-4000-8000-${TAG}a02`));
    const nothing = await call(w, await editBody(id, { adminMessage: 'Gate code 1234' }));
    ok('edit: saving with nothing changed writes nothing', nothing.status === 200 && nothing.json?.saved === false);
  }
  {
    // adding equipment: priced by the server from the catalog; the browser cannot supply the line price
    const w = newWorld();
    const id = await createOrder(w);
    const before = await orderRow(id);
    const items = [...(await editBody(id)).items, { kind: 'inflatable', unit_id: U2, wet_or_dry: 'dry', qty: 1 }];
    const r = await call(w, { ...(await editBody(id)), items });
    ok('edit: adding a unit saves', r.status === 200 && r.json?.saved === true);
    const o = await orderRow(id);
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }, { unit_id: U2, qty: 1, price: 31250 }]);
    eq('edit: the subtotal and deposit are the engine\'s for the new equipment (catalog price for the new line, stored price for the old)', [o.subtotal_cents, o.deposit_due_cents], [exp.subtotal_cents, exp.deposit_due_cents]);
    eq('edit: ...the new line was written at the catalog price', (await rowsOf('order_items', id)).map((i: any) => i.unit_price_cents).sort(), [25000, 31250]);
    ok('edit: ...and the money moved only because the equipment did', o.subtotal_cents !== before.subtotal_cents);
    const priced = await call(w, { ...(await editBody(id)), items: [...(await editBody(id)).items, { kind: 'inflatable', unit_id: U2, wet_or_dry: 'dry', qty: 1, unit_price_cents: 1 }] });
    ok('edit: a line price in an edit request is refused (a stored line keeps its price; a new line is priced by the catalog)', priced.status === 400);
    const foreign = await call(w, { ...(await editBody(id)), items: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', kind: 'inflatable', qty: 1, is_deleted: false, is_updated: true }] });
    ok('edit: an item that is not on this order is refused', foreign.status === 400);
  }
  for (const [label, extra] of [
    ['subtotal', { subtotal_cents: 1 }], ['tax', { tax_cents: 0 }], ['total', { total_cents: 1 }], ['deposit', { deposit_due_cents: 0 }], ['balance', { balance_due_cents: 0 }],
    ['a negative fee substitution', { surface_fee_cents: -3500 }], ['a zero fee substitution', { travel_fee_cents: 0 }], ['a duplicate weekday fee', { same_day_weekday_delivery_fee_cents: 5000 }],
    ['a huge subtotal', { subtotal_cents: 999999999 }], ['calculatedPricing', { calculatedPricing: { total_cents: 1 } }],
  ] as Array<[string, Record<string, unknown>]>) {
    const w = newWorld();
    const id = await createOrder(w);
    const before = await orderRow(id);
    const r = await call(w, { ...(await editBody(id, { adminMessage: 'tamper' })), ...extra });
    ok(`edit tamper (${label}): refused`, r.status === 400);
    eq(`edit tamper (${label}): the order is untouched`, await orderRow(id), before);
  }
  {
    // a "debug copy" of the browser's totals is ignored; the persisted money is the server's
    const w = newWorld();
    const id = await createOrder(w);
    const before = moneyOf(await orderRow(id));
    const items = [...(await editBody(id)).items, { kind: 'inflatable', unit_id: U2, wet_or_dry: 'dry', qty: 1 }];
    const r = await call(w, { ...(await editBody(id)), items, clientPricing: { subtotal_cents: 1, tax_cents: 0, total_cents: 1, deposit_due_cents: 0, balance_due_cents: 0 } });
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }, { unit_id: U2, qty: 1, price: 31250 }]);
    const o = await orderRow(id);
    ok('edit: with a comparison copy claiming subtotal 1 / tax 0 / total 1 / deposit 0 / balance 0 the save still persists the canonical values', r.status === 200 && o.subtotal_cents === exp.subtotal_cents && o.tax_cents === exp.tax_cents && o.deposit_due_cents === exp.deposit_due_cents && o.balance_due_cents === exp.balance_due_cents && o.subtotal_cents !== 1);
    ok('edit: ...and those values are not the ones that were there before', JSON.stringify(moneyOf(o)) !== JSON.stringify(before));
  }
  {
    // explicit overrides are saved as explicit overrides
    const w = newWorld();
    const id = await createOrder(w);
    const zero = await call(w, await editBody(id, { customDepositCents: 0 }));
    const o0 = await orderRow(id);
    ok('edit: an explicit zero deposit override is saved as 0 (not dropped)', zero.status === 200 && o0.custom_deposit_cents === 0 && o0.deposit_due_cents === 0);
    const set = await call(w, await editBody(id, { customDepositCents: 7000 }));
    ok('edit: a positive deposit override is saved', set.status === 200 && (await orderRow(id)).deposit_due_cents === 7000 && (await orderRow(id)).custom_deposit_cents === 7000);
    const cleared = await call(w, await editBody(id, { customDepositCents: null }));
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }]);
    ok('edit: clearing the override returns to the formula deposit', cleared.status === 200 && (await orderRow(id)).custom_deposit_cents === null && (await orderRow(id)).deposit_due_cents === exp.deposit_due_cents);
    const negative = await call(w, await editBody(id, { customDepositCents: -1 }));
    ok('edit: a negative override is refused', negative.status === 400);
  }
  {
    // a discount and a custom fee through an edit
    const w = newWorld();
    const id = await createOrder(w);
    const r = await call(w, await editBody(id, { discounts: [{ name: 'Loyalty', amount_cents: 1500, percentage: 10 }], customFees: [{ name: 'Cleaning', amount_cents: 2500 }] }));
    ok('edit: adding a discount and a custom fee saves', r.status === 200);
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }], { discounts: [{ name: 'Loyalty', amount_cents: 1500, percentage: 10 }], customFees: [{ name: 'Cleaning', amount_cents: 2500 }] });
    eq('edit: the tax and balance follow the engine (the fixed discount wins; the fee is taxed)', [(await orderRow(id)).tax_cents, (await orderRow(id)).balance_due_cents], [exp.tax_cents, exp.balance_due_cents]);
    ok('edit: the rows were written', (await rowsOf('order_discounts', id)).length === 1 && (await rowsOf('order_custom_fees', id)).length === 1);
    const state = await loadState(id);
    const removed = await call(w, { ...(await editBody(id)), expectedState: state, discounts: [], customFees: [] });
    ok('edit: removing them deletes the rows and restores the money', removed.status === 200 && (await rowsOf('order_discounts', id)).length === 0 && (await rowsOf('order_custom_fees', id)).length === 0);
  }

  // =================================================================================================================
  // 4. Stale saves
  // =================================================================================================================
  {
    const w = newWorld();
    const id = await createOrder(w);
    const stale = await editBody(id, { adminMessage: 'from a stale screen' });
    // someone else saves first (a pricing change)
    const other = await call(w, await editBody(id, { customDepositCents: 9000 }));
    ok('stale: the first save succeeds', other.status === 200);
    const after = await orderRow(id);
    const r = await call(w, stale);
    ok('stale: a save made from a screen that has not seen the newer pricing is refused (409 STALE_ORDER)', r.status === 409 && r.json?.code === 'STALE_ORDER');
    eq('stale: ...and it did not overwrite anything', await orderRow(id), after);
    const fresh = await call(w, await editBody(id, { adminMessage: 'from a fresh screen' }));
    ok('stale: reloading and saving again works', fresh.status === 200);
  }
  {
    // a payment changes the order between the screen and the save
    const w = newWorld();
    const id = await createOrder(w);
    const stale = await editBody(id, { adminMessage: 'x' });
    await pg.exec(`UPDATE public.orders SET deposit_paid_cents = 1000 WHERE id = '${id}';`);
    const r = await call(w, stale);
    ok('stale: a payment that arrived since the screen loaded makes the save stale', r.status === 409 && r.json?.code === 'STALE_ORDER');
  }
  {
    // two saves from the same screen state at the same moment: exactly one wins, under the database row lock
    const w = newWorld();
    const id = await createOrder(w);
    const a = await editBody(id, { customDepositCents: 6000 });
    const b = await editBody(id, { customDepositCents: 8000 });
    const [ra, rb] = await Promise.all([call(w, a), call(w, b)]);
    const statuses = [ra.status, rb.status].sort();
    eq('race: two simultaneous saves from one state - one saved, one refused as stale', statuses, [200, 409]);
    const dep = (await orderRow(id)).deposit_due_cents;
    ok('race: ...and the stored deposit is the winner\'s, not a mixture', dep === 6000 || dep === 8000);
  }
  {
    // the database itself refuses a stale save even if the server pre-check were bypassed
    const w = newWorld();
    const id = await createOrder(w);
    const state = await loadState(id);
    await pg.exec(`UPDATE public.orders SET tax_cents = tax_cents + 1 WHERE id = '${id}';`);
    const rpc = await pg.query(`SELECT public.apply_staff_order_save('${id}', NULL, ${lit(state)}, ${lit({ admin_message: 'x' })}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) AS j`, true);
    ok('stale (database): the RPC refuses a state that no longer matches, under the order lock', rpc[0]?.j?.outcome === 'stale' && (await orderRow(id)).admin_message !== 'x');
  }
  {
    // a payment in flight blocks a pricing change (the state barrier)
    const w = newWorld();
    const id = await createOrder(w);
    await pg.exec(`INSERT INTO public.payments (id, order_id, type, amount_cents, status, operation_key, principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, claim_id, claimed_at, order_financials_applied) VALUES (gen_random_uuid(), '${id}', 'deposit', 5000, 'pending', 'bpc-pay-${id}-deposit-x', 5000, 0, 5000, 0, gen_random_uuid(), now(), false);`);
    const r = await call(w, await editBody(id, { customDepositCents: 1000 }));
    ok('barrier: a pricing change while a payment is in flight is refused (409 PAYMENT_IN_PROGRESS)', r.status === 409 && (r.json?.code === 'PAYMENT_IN_PROGRESS' || r.json?.code === 'SAVE_FAILED'));
    ok('barrier: ...and the deposit did not change', (await orderRow(id)).custom_deposit_cents === null);
    await pg.exec(`DELETE FROM public.payments WHERE order_id = '${id}';`);
  }

  // =================================================================================================================
  // 5. Waived fee amounts
  // =================================================================================================================
  {
    const w = newWorld(RULES);
    const id = await createOrder(w);
    const waiveTravel = await call(w, await editBody(id, { waivers: { travel: { waived: true, reason: 'goodwill' } } }));
    ok('waive: waiving a fee saves', waiveTravel.status === 200);
    const o1 = await orderRow(id);
    const expectedAmount = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }]).travel_fee_cents;
    ok('waive: the fee is not charged and the amount it was waived at is kept', o1.travel_fee_cents === 0 && o1.waived_fee_amounts_cents?.travel === expectedAmount && expectedAmount > 0);
    ok('waive: it displays as "$X - Waived" with that amount', storedFeeAmounts(o1).travel_fee_cents === expectedAmount && storedFeeAmounts(o1).waived_amount_unknown.length === 0);
    // the rules change; the order is edited for an unrelated reason
    w.tables.pricing_rules = [{ ...RULES_LATER }];
    const note = await call(w, await editBody(id, { adminMessage: 'note', waivers: { travel: { waived: true, reason: 'goodwill' } } }));
    ok('waive: a later unrelated edit under new rules saves', note.status === 200);
    const o2 = await orderRow(id);
    eq('waive: ...the waived amount is still what it was (not today\'s per-mile rate)', o2.waived_fee_amounts_cents, o1.waived_fee_amounts_cents);
    eq('waive: ...and the displayed amount did not change', storedFeeAmounts(o2).travel_fee_cents, expectedAmount);
    const laterTravel = expectedForNew(RULES_LATER, [{ unit_id: U1, qty: 1, price: 25000 }]).travel_fee_cents;
    ok('waive: (today\'s rule would have said something different)', laterTravel !== expectedAmount);
    const unwaive = await call(w, await editBody(id, { waivers: {} }));
    ok('waive: removing the waiver prices the fee again (today\'s rule, because the Admin changed it) and drops the kept amount', unwaive.status === 200 && (await orderRow(id)).travel_fee_cents === laterTravel && (await orderRow(id)).waived_fee_amounts_cents === null);
  }
  {
    // a LEGACY waiver (no amount was ever stored): it stays unknown and is never guessed
    const w = newWorld(RULES);
    const id = await createOrder(w);
    await pg.exec(`UPDATE public.orders SET travel_fee_waived = true, travel_fee_cents = 0, travel_fee_waive_reason = 'legacy', waived_fee_amounts_cents = NULL WHERE id = '${id}';`);
    w.tables.pricing_rules = [{ ...RULES_LATER }];
    const o0 = await orderRow(id);
    eq('legacy waiver: nothing is known about its amount - displays say "Waived" with no dollar figure', storedFeeAmounts(o0).waived_amount_unknown, ['travel']);
    eq('legacy waiver: ...and the shown amount is 0, not today\'s rule', storedFeeAmounts(o0).travel_fee_cents, 0);
    const r = await call(w, await editBody(id, { adminMessage: 'note', waivers: { travel: { waived: true, reason: 'legacy' } } }));
    ok('legacy waiver: an unrelated edit saves', r.status === 200);
    const o = await orderRow(id);
    ok('legacy waiver: ...and the amount is still not recorded (no guess was made from today\'s rules)', o.waived_fee_amounts_cents === null && o.travel_fee_cents === 0);
    eq('legacy waiver: ...still displayed as unknown', storedFeeAmounts(o).waived_amount_unknown, ['travel']);
  }

  // =================================================================================================================
  // 6. Address and distance
  // =================================================================================================================
  {
    const w = newWorld();
    const id = await createOrder(w);
    const move = await editBody(id);
    distanceFor = (d) => (d.includes('Far Road') ? 30 : 14.2);
    const moved = { ...move, edited: { ...move.edited, address_line1: `${TAG} Far Road`, address_city: 'Detroit', address_zip: '48201', address_lat: 42.5, address_lng: -83.5 } };
    const r = await call(w, moved);
    ok('address: moving the event address saves and reprices travel from the SERVER-measured distance', r.status === 200 && (await orderRow(id)).travel_fee_cents === expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }], {}, 30).travel_fee_cents);
    ok('address: ...and the order points at the new canonical address', (await orderRow(id)).address_id !== null);
    distanceFor = () => 14.2;
  }

  // =================================================================================================================
  // 7. The delivery distance is measured by the server (the browser's miles and coordinates are not inputs)
  // =================================================================================================================
  const feeFor = (miles: number) => expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }], {}, miles);
  {
    const w = newWorld();
    // 7a. a mileage field is not part of the contract at all, whatever its value (create and edit)
    distanceFor = () => 40;
    for (const miles of [0, 1, 500, -3, 14.2, '12', null]) {
      const before = await orderCount();
      const r = await call(w, invoiceBody({ measuredDistanceMiles: miles }));
      ok(`distance: create_invoice with measuredDistanceMiles=${JSON.stringify(miles)} is refused (unknown field) and creates nothing`, r.status === 400 && (await orderCount()) === before);
    }
    // 7b. the travel fee comes from the miles the server measured, with no mileage in the request
    const calls0 = distanceCalls.length;
    const made = await call(w, invoiceBody());
    ok('distance: create_invoice with no mileage succeeds', made.status === 200);
    createdOrders.push(made.json.orderId);
    const row = await orderRow(made.json.orderId);
    eq('distance: the travel fee is the server-measured 40 miles', [row.travel_fee_cents, Number(row.travel_total_miles)], [feeFor(40).travel_fee_cents, 40]);
    ok('distance: the server measured the street address TEXT (not browser coordinates)', distanceCalls.length === calls0 + 1 && distanceCalls[distanceCalls.length - 1].includes(STREET) && distanceCalls[distanceCalls.length - 1].includes('Detroit') && distanceCalls[distanceCalls.length - 1].includes('48201'));

    // 7c. coordinates near the shop for a far address, and far coordinates for a near address, change nothing
    distanceFor = () => 60;
    const nearCoords = await call(w, invoiceBody({ eventDetails: eventBase({ lat: 42.2808, lng: -83.3863 }) }));
    createdOrders.push(nearCoords.json.orderId);
    eq('distance: shop-adjacent coordinates on a far address do not shrink the travel fee', (await orderRow(nearCoords.json.orderId)).travel_fee_cents, feeFor(60).travel_fee_cents);
    distanceFor = () => 3;
    const farCoords = await call(w, invoiceBody({ eventDetails: eventBase({ lat: 45.0, lng: -90.0 }) }));
    createdOrders.push(farCoords.json.orderId);
    eq('distance: far-away coordinates on a near address do not inflate the travel fee', (await orderRow(farCoords.json.orderId)).travel_fee_cents, feeFor(3).travel_fee_cents);
    const noCoords = await call(w, invoiceBody({ eventDetails: (() => { const e: any = eventBase(); delete e.lat; delete e.lng; return e; })() }));
    ok('distance: an address with no coordinates at all is still priced (the server geocodes it)', noCoords.status === 200);
    createdOrders.push(noCoords.json.orderId);

    // 7d. when the server cannot measure, nothing is created and nothing is guessed
    for (const [label, value] of [['unavailable', null], ['not a number', Number.NaN], ['negative', -5], ['implausibly large', 501]] as Array<[string, number | null]>) {
      distanceFor = () => value;
      const before = await orderCount();
      const r = await call(w, invoiceBody());
      ok(`distance: a ${label} measurement is refused (503 DISTANCE_UNAVAILABLE) and creates nothing`, r.status === 503 && r.json?.code === 'DISTANCE_UNAVAILABLE' && (await orderCount()) === before);
    }
    distanceFor = () => 14.2;
  }
  {
    // 7e. an edit: the stored travel snapshot stands for an unchanged address; nothing is re-measured and nothing the browser sends changes it
    const w = newWorld();
    distanceFor = () => 40;
    const id = await createOrder(w);
    const stored = await orderRow(id);
    distanceFor = () => 5; // the world has changed; the stored snapshot must not follow it
    const calls0 = distanceCalls.length;
    const note = await call(w, await editBody(id, { adminMessage: 'note only' }));
    ok('distance: a note-only edit saves without measuring again', note.status === 200 && distanceCalls.length === calls0);
    let after = await orderRow(id);
    eq('distance: ...and the travel fee and miles are unchanged', [after.travel_fee_cents, after.travel_total_miles], [stored.travel_fee_cents, stored.travel_total_miles]);
    const dated = await call(w, await editBody(id, { edited: { ...(await editBody(id)).edited, generator_qty: 1 } }));
    ok('distance: an unrelated pricing edit (a generator) reuses the stored distance', dated.status === 200 && distanceCalls.length === calls0);
    after = await orderRow(id);
    eq('distance: ...the travel snapshot is still the stored one', [after.travel_fee_cents, after.travel_total_miles], [stored.travel_fee_cents, stored.travel_total_miles]);
    for (const miles of [0, 1, 500, '9']) {
      const r = await call(w, await editBody(id, { measuredDistanceMiles: miles }));
      ok(`distance: an edit carrying measuredDistanceMiles=${JSON.stringify(miles)} is refused`, r.status === 400);
    }
    eq('distance: ...and the order is untouched by those refusals', (await orderRow(id)).travel_total_miles, after.travel_total_miles);
    // coordinates sent for the SAME address are not a trigger to reprice
    const sameAddr = await call(w, await editBody(id, { edited: { ...(await editBody(id)).edited, address_lat: 42.2808, address_lng: -83.3863 } }));
    ok('distance: new coordinates for the same address do not re-measure or reprice travel', sameAddr.status === 200 && distanceCalls.length === calls0 && (await orderRow(id)).travel_fee_cents === stored.travel_fee_cents);
    // moving the address measures the NEW address, whatever coordinates come with it
    distanceFor = () => 33;
    const moveReq = await editBody(id);
    const moved = await call(w, { ...moveReq, edited: { ...moveReq.edited, address_line1: `${TAG} Moved Road`, address_lat: 42.2808, address_lng: -83.3863 } });
    after = await orderRow(id);
    ok('distance: moving the address measures the new address (shop-adjacent coordinates notwithstanding)', moved.status === 200 && distanceCalls[distanceCalls.length - 1].includes('Moved Road') && Number(after.travel_total_miles) === 33 && after.travel_fee_cents === feeFor(33).travel_fee_cents);
    distanceFor = () => null;
    const stuck = await editBody(id);
    const refused = await call(w, { ...stuck, edited: { ...stuck.edited, address_line1: `${TAG} Unmeasurable Road` } });
    ok('distance: moving to an address that cannot be measured is refused and changes nothing', refused.status === 503 && refused.json?.code === 'DISTANCE_UNAVAILABLE' && (await orderRow(id)).travel_total_miles === after.travel_total_miles);
    distanceFor = () => 14.2;
  }
  {
    // 7f. a legacy order (miles never recorded) with an unchanged address is still editable without any measurement
    const w = newWorld();
    const id = await createOrder(w);
    await pg.exec(`UPDATE public.orders SET travel_total_miles = NULL, travel_fee_cents = 0, travel_chargeable_miles = NULL WHERE id = '${id}';`);
    distanceFor = () => null;
    const calls0 = distanceCalls.length;
    const r = await call(w, await editBody(id, { adminMessage: 'legacy edit' }));
    ok('distance: a legacy order with no recorded miles saves a note without any measurement (and without a browser write-back)', r.status === 200 && distanceCalls.length === calls0 && (await orderRow(id)).travel_total_miles === null);
    distanceFor = () => 14.2;
  }
  {
    // 7f-bis. a legacy order with NO travel snapshot at all (rate and radius never stored) and a $0 fee: shouldReuseSavedTravel says no, but the
    // address text is unchanged, so nothing is measured (the unchanged-address rule stands on its own; a browser value cannot change it either)
    const w = newWorld();
    const id = await createOrder(w);
    await pg.exec(`UPDATE public.orders SET travel_total_miles = NULL, travel_fee_cents = 0, travel_chargeable_miles = NULL, travel_per_mile_cents = NULL, travel_base_radius_miles = NULL WHERE id = '${id}';`);
    distanceFor = () => 77;
    const calls0 = distanceCalls.length;
    const r = await call(w, await editBody(id, { adminMessage: 'legacy edit without snapshot' }));
    ok('distance: a legacy order with no travel snapshot and an unchanged address is not re-measured', r.status === 200 && distanceCalls.length === calls0);
    distanceFor = () => 14.2;
  }
  {
    // 7h. WP-18: a typed free city (Plymouth) that the server cannot confirm leaves an Admin-visible review row (order history, pending card,
    // new-booking alert) in the EXISTING order_changelog table; a non-free city, or a confirmed one, leaves none
    const w = newWorld();
    const reviewRows = async (id: string) => (await rowsOf('order_changelog', id)).filter((r: any) => r.change_type === 'travel_city_review');
    const plymouth = await createOrder(w, { eventDetails: eventBase({ city: 'Plymouth' }) });
    let rows = await reviewRows(plymouth);
    ok('travel review: an unconfirmed typed free city on a new staff invoice records one review row', rows.length === 1 && rows[0].new_value === 'typed_free_city_not_verified' && rows[0].old_value === 'Plymouth' && rows[0].field_changed === 'travel_city');
    ok('travel review: the note tells the Admin what to do (check the address / waive with a reason) and names the typed city', /Plymouth/.test(rows[0].notes) && /waive the travel fee with a reason/.test(rows[0].notes));
    ok('travel review: the row carries the acting staff member', rows[0].user_id === w.users['jwt-admin']);
    ok('travel review: the distance fee was applied, not a free grant', Number((await orderRow(plymouth)).travel_fee_cents) > 0);
    const detroit = await createOrder(w);
    eq('travel review: a city that is not on the free list records nothing', (await reviewRows(detroit)).length, 0);
    // moving the address and typing the free city again: one row per outcome, not one per save
    const mv = await editBody(plymouth);
    const moved2 = await call(w, { ...mv, edited: { ...mv.edited, address_line1: `${TAG} Plymouth Road`, address_city: 'Plymouth', address_lat: 42.37, address_lng: -83.47 } });
    ok('travel review: an address edit that still cannot be confirmed saves', moved2.status === 200);
    eq('travel review: ...and does not repeat the same review row', (await reviewRows(plymouth)).length, 1);
  }
  {
    // 7g. the production wiring: no injected measurer, GOOGLE_MAPS_API_KEY and the Distance Matrix REST service
    const prod = (w: World) => loadHandler('staff-order-save', w, sharedProduction);
    const callProd = (w: World, body: Record<string, unknown>, bearer = 'jwt-admin') => callHandler(prod(w), body, bearer);
    const g = globalThis as any;
    const hadDeno = Object.prototype.hasOwnProperty.call(g, 'Deno');
    const realDeno = g.Deno;
    const realFetch = g.fetch;
    const requests: string[] = [];
    try {
      const w = newWorld();
      // no key configured -> fail closed, nothing created
      g.Deno = { env: { get: () => undefined } };
      const before = await orderCount();
      const noKey = await callProd(w, invoiceBody());
      ok('production wiring: with no GOOGLE_MAPS_API_KEY the invoice is refused (503 DISTANCE_UNAVAILABLE), nothing created', noKey.status === 503 && noKey.json?.code === 'DISTANCE_UNAVAILABLE' && (await orderCount()) === before);

      g.Deno = { env: { get: (k: string) => (k === 'GOOGLE_MAPS_API_KEY' ? 'test-key' : undefined) } };
      g.fetch = async (url: string) => {
        requests.push(String(url));
        return { ok: true, json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 40233.6 } }] }] }) } as any;
      };
      const r = await callProd(w, invoiceBody({ eventDetails: eventBase({ lat: 42.2808, lng: -83.3863 }) }));
      ok('production wiring: with the key, Google answers and the invoice is priced from it', r.status === 200);
      createdOrders.push(r.json.orderId);
      const row = await orderRow(r.json.orderId);
      eq('production wiring: 40233.6 m is 25.00 miles and the travel fee follows', [Number(row.travel_total_miles), row.travel_fee_cents], [25, feeFor(25).travel_fee_cents]);
      const u = new URL(requests[0]);
      eq('production wiring: the Distance Matrix origin is the shop and the destination is the address text', [u.searchParams.get('origins'), u.searchParams.get('destinations'), u.searchParams.get('mode'), u.searchParams.get('key')],
        ['42.2808,-83.3863', `${STREET}, Detroit, MI 48201`, 'driving', 'test-key']);
      ok('production wiring: no browser coordinates are sent to Google', !/42\.3,-83\.36/.test(requests[0]));

      g.fetch = async () => ({ ok: true, json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] }) }) as any;
      const zero = await callProd(w, invoiceBody());
      ok('production wiring: an address Google cannot route to is refused', zero.status === 503 && zero.json?.code === 'DISTANCE_UNAVAILABLE');
      g.fetch = async () => { throw new Error('network down'); };
      const down = await callProd(w, invoiceBody());
      ok('production wiring: a Google outage is refused, never guessed', down.status === 503 && down.json?.code === 'DISTANCE_UNAVAILABLE');
    } finally {
      if (hadDeno) g.Deno = realDeno; else delete g.Deno;
      g.fetch = realFetch;
    }
    // the lookup itself
    const lookup = (response: any, apiKey = 'k') => staffSave.createGoogleDrivingMiles({ apiKey, fetchImpl: (async () => response) as any });
    const okBody = (value: number) => ({ ok: true, json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value } }] }] }) });
    eq('google lookup: meters become miles', Math.round(((await lookup(okBody(16093.4))('1 Main St, Wayne, MI 48184')) ?? -1) * 100) / 100, 10);
    eq('google lookup: a non-200 answer is null', await lookup({ ok: false, json: async () => ({}) })('1 Main St'), null);
    eq('google lookup: a top-level error status is null', await lookup({ ok: true, json: async () => ({ status: 'REQUEST_DENIED', rows: [] }) })('1 Main St'), null);
    eq('google lookup: an element error is null', await lookup({ ok: true, json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'NOT_FOUND' }] }] }) })('1 Main St'), null);
    eq('google lookup: a missing distance is null', await lookup({ ok: true, json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'OK' }] }] }) })('1 Main St'), null);
    eq('google lookup: no key is null (no request is made)', await lookup(okBody(1000), '')('1 Main St'), null);
    eq('google lookup: an empty destination is null', await lookup(okBody(1000))('   '), null);
    eq('google lookup: a thrown fetch is null', await staffSave.createGoogleDrivingMiles({ apiKey: 'k', fetchImpl: (async () => { throw new Error('x'); }) as any })('1 Main St'), null);
  }

  // =================================================================================================================
  // 8. Crew: the verified role, not the request, decides what an invoice may contain
  // =================================================================================================================
  {
    const w = newWorld();
    const crewCases: Array<[string, Record<string, unknown>]> = [
      ['an adjusted line price below the catalog', { items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 1, unit_price_cents: 100 }] }],
      ['a zero line price', { items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 1, unit_price_cents: 0 }] }],
      ['a line price above the catalog', { items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 1, unit_price_cents: 99999 }] }],
      ['the DRY price on a water line', { items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'water', qty: 1, unit_price_cents: 25000 }] }],
      ['a fixed discount', { discounts: [{ name: 'Friend', amount_cents: 1000 }] }],
      ['a percentage discount', { discounts: [{ name: 'Friend', percentage: 100 }] }],
      ['a custom fee', { customFees: [{ name: 'Extra', amount_cents: 500 }] }],
      ['a tax waiver', { waivers: { tax: { waived: true, reason: 'r' } } }],
      ['a travel waiver', { waivers: { travel: { waived: true, reason: 'r' } } }],
      ['a surface waiver', { waivers: { surface: { waived: true, reason: 'r' } } }],
      ['a generator waiver', { waivers: { generator: { waived: true, reason: 'r' } } }],
      ['a same-day pickup waiver', { waivers: { same_day_pickup: { waived: true, reason: 'r' } } }],
      ['a weekday delivery waiver', { waivers: { same_day_weekday_delivery: { waived: true, reason: 'r' } } }],
      ['a waiver reason without a waiver', { waivers: { tax: { waived: false, reason: 'sneak' } } }],
      ['a custom deposit', { customDepositCents: 1000 }],
      ['an explicit zero deposit', { customDepositCents: 0 }],
      ['a custom setup fee', { customSetupFeeCents: 2500 }],
      ['an explicit zero setup fee', { customSetupFeeCents: 0 }],
      ['a card-on-file opt-out', { requireCardOnFile: false }],
    ];
    for (const [label, extra] of crewCases) {
      const before = await orderCount();
      const r = await call(w, invoiceBody(extra), 'jwt-crew');
      ok(`crew: ${label} is refused (403 FIELD_NOT_PERMITTED) and nothing is created`, r.status === 403 && r.json?.code === 'FIELD_NOT_PERMITTED' && (await orderCount()) === before);
    }
    const claim = await call(w, invoiceBody({ canOverridePricing: true }), 'jwt-crew');
    ok('crew: a request that claims the capability for itself is refused as an unknown field', claim.status === 400);
    const claimAdmin = await call(w, invoiceBody({ canOverridePricing: false }));
    ok('capability: even for an Admin the capability is not a request field', claimAdmin.status === 400);

    // a normal Crew invoice
    const ok1 = await call(w, invoiceBody(), 'jwt-crew');
    ok('crew: a normal invoice succeeds', ok1.status === 200);
    createdOrders.push(ok1.json.orderId);
    const crewRow = await orderRow(ok1.json.orderId);
    const exp = expectedForNew(RULES, [{ unit_id: U1, qty: 1, price: 25000 }]);
    eq('crew: ...with catalog pricing (the engine\'s money)', moneyOf(crewRow), moneyOf({ ...crewRow, ...{ subtotal_cents: exp.subtotal_cents, travel_fee_cents: exp.travel_fee_cents, surface_fee_cents: exp.surface_fee_cents, same_day_pickup_fee_cents: exp.same_day_pickup_fee_cents, same_day_weekday_delivery_fee_cents: exp.same_day_weekday_delivery_fee_cents, generator_fee_cents: exp.generator_fee_cents, setup_fee_cents: exp.setup_fee_cents, tax_cents: exp.tax_cents, deposit_due_cents: exp.deposit_due_cents, balance_due_cents: exp.balance_due_cents } }));
    ok('crew: ...no discount, fee, waiver, deposit override, and card on file required', (await rowsOf('order_discounts', ok1.json.orderId)).length === 0 && (await rowsOf('order_custom_fees', ok1.json.orderId)).length === 0 && crewRow.tax_waived === false && crewRow.travel_fee_waived === false && crewRow.custom_deposit_cents === null && crewRow.require_card_on_file === true && crewRow.waived_fee_amounts_cents === null);
    // what the Crew builder legitimately sends: the catalog price on the line, the card-on-file default, a message, generator, address
    const builder = await call(w, invoiceBody({
      items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 2, unit_price_cents: 25000 }, { kind: 'inflatable', unit_id: U2, wet_or_dry: 'dry', qty: 1, unit_price_cents: 31250 }],
      eventDetails: eventBase({ generator_qty: 1, location_type: 'commercial', surface: 'cement', pickup_preference: 'same_day' }), adminMessage: 'Crew message', requireCardOnFile: true,
    }), 'jwt-crew');
    ok('crew: the builder\'s request (catalog line prices, generator, surface, pickup, message) succeeds', builder.status === 200);
    createdOrders.push(builder.json.orderId);
    const builderRow = await orderRow(builder.json.orderId);
    const items = await rowsOf('order_items', builder.json.orderId);
    ok('crew: ...the stored lines are at catalog prices and the message is kept', items.map((i: any) => i.unit_price_cents).sort().join() === '25000,31250' && builderRow.admin_message === 'Crew message');
    const water = await call(w, invoiceBody({ items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'water', qty: 1, unit_price_cents: 30000 }] }), 'jwt-crew');
    ok('crew: a water line at the catalog WATER price is accepted', water.status === 200);
    createdOrders.push(water.json.orderId);
    // Crew can never edit an existing order's pricing
    const crewOrder = await createOrder(w);
    const edit = await call(w, await editBody(crewOrder), 'jwt-crew');
    ok('crew: save_changes is refused', edit.status === 403);
    const custEdit = await call(w, await editBody(crewOrder), 'jwt-cust');
    ok('customer: save_changes is refused', custEdit.status === 403);
    const custInvoice = await call(w, invoiceBody(), 'jwt-cust');
    ok('customer: create_invoice is refused', custInvoice.status === 403);
    const anonInvoice = await call(w, invoiceBody(), null);
    ok('anonymous: create_invoice is refused', anonInvoice.status === 401 || anonInvoice.status === 403);

    // Admin and Master keep every feature Crew lost
    for (const who of ['jwt-admin', 'jwt-master']) {
      const full = await call(w, invoiceBody({
        items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 1, unit_price_cents: 20000 }],
        discounts: [{ name: 'Promo', amount_cents: 1000 }], customFees: [{ name: 'Help', amount_cents: 2000 }], waivers: { tax: { waived: true, reason: 'nonprofit' } },
        customDepositCents: 0, customSetupFeeCents: 0, requireCardOnFile: false,
      }), who);
      ok(`${who}: adjusted price, discount, custom fee, waiver, zero deposit, zero setup fee and no card on file are all accepted`, full.status === 200);
      createdOrders.push(full.json.orderId);
      const fr = await orderRow(full.json.orderId);
      ok(`${who}: ...and they are stored`, (await rowsOf('order_items', full.json.orderId))[0].unit_price_cents === 20000 && (await rowsOf('order_discounts', full.json.orderId)).length === 1 && (await rowsOf('order_custom_fees', full.json.orderId)).length === 1 && fr.tax_waived === true && fr.custom_deposit_cents === 0 && fr.require_card_on_file === false && fr.setup_fee_cents === 0);
    }
    // the module's own default is deny (an Edge Function that forgot the capability grants nothing)
    const { action: _a, ...bareBody } = invoiceBody({ discounts: [{ name: 'x', amount_cents: 1 }] }) as any;
    void _a;
    // a refusal is an answer; running on and touching the database is not, so a throw counts as "not refused"
    const refusedOrThrew = async (run: () => Promise<{ status: number }>) => { try { return await run(); } catch { return { status: -1 }; } };
    const direct = await refusedOrThrew(() => staffSave.createStaffInvoiceOrder({ db: {}, actingUserId: U1 } as any, bareBody));
    ok('capability: createStaffInvoiceOrder without the capability refuses an Admin-only field (default is deny)', direct.status === 403);
    const directSave = await refusedOrThrew(() => staffSave.saveStaffOrderChanges({ db: {}, actingUserId: U1 } as any, {}));
    ok('capability: saveStaffOrderChanges without the capability is refused before anything is read', directSave.status === 403);
  }

  // =================================================================================================================
  // 9. A stale view is stale for every field the next save would rely on
  // =================================================================================================================
  {
    const staleCase = async (label: string, makeOrder: Record<string, unknown>, change: (id: string, w: World) => Promise<void>) => {
      const w = newWorld();
      const id = await createOrder(w, makeOrder);
      const a = await editBody(id, { adminMessage: `A-${label}` }); // Admin A loaded the order
      await change(id, w); // Admin B (or any other writer) changed it
      const before = await orderRow(id);
      const r = await call(w, a); // A saves from the old view
      const afterRow = await orderRow(id);
      ok(`stale (${label}): A's old view is refused as STALE_ORDER`, r.status === 409 && r.json?.code === 'STALE_ORDER');
      eq(`stale (${label}): ...and nothing of A's was written`, afterRow, before);
    };
    const bSaves = async (id: string, w: World, over: Record<string, unknown>) => {
      const r = await call(w, await editBody(id, over), 'jwt-master');
      if (r.status !== 200) throw new Error('B save failed ' + JSON.stringify(r.json));
    };
    await staleCase('tax waiver flag', {}, (id, w) => bSaves(id, w, { waivers: { tax: { waived: true, reason: 'exempt' } } }));
    await staleCase('tax waiver reason', { waivers: { tax: { waived: true, reason: 'exempt' } } }, (id, w) => bSaves(id, w, { waivers: { tax: { waived: true, reason: 'changed reason' } } }));
    await staleCase('travel waiver flag', { eventDetails: eventBase({ city: 'Detroit' }) }, (id, w) => bSaves(id, w, { waivers: { travel: { waived: true, reason: 'goodwill' } } }));
    await staleCase('surface waiver flag', {}, (id, w) => bSaves(id, w, { waivers: { surface: { waived: true, reason: 'x' } } }));
    await staleCase('generator waiver flag', {}, (id, w) => bSaves(id, w, { waivers: { generator: { waived: true, reason: 'x' } } }));
    await staleCase('same-day pickup waiver flag', {}, (id, w) => bSaves(id, w, { waivers: { same_day_pickup: { waived: true, reason: 'x' } } }));
    await staleCase('weekday delivery waiver flag', {}, (id, w) => bSaves(id, w, { waivers: { same_day_weekday_delivery: { waived: true, reason: 'x' } } }));
    const sqlCases: Array<[string, string]> = [
      ['waived amounts', `waived_fee_amounts_cents = '{"travel": 12345}'::jsonb`],
      ['tax waive reason (direct)', `tax_waive_reason = 'someone else'`],
      ['travel waive reason (direct)', `travel_fee_waive_reason = 'someone else'`],
      ['surface waive reason (direct)', `surface_fee_waive_reason = 'someone else'`],
      ['generator waive reason (direct)', `generator_fee_waive_reason = 'someone else'`],
      ['same-day pickup waive reason (direct)', `same_day_pickup_fee_waive_reason = 'someone else'`],
      ['weekday delivery waive reason (direct)', `same_day_weekday_delivery_fee_waive_reason = 'someone else'`],
      ['surface waived flag (direct)', `surface_fee_waived = true`],
      ['generator waived flag (direct)', `generator_fee_waived = true`],
      ['pickup waived flag (direct)', `same_day_pickup_fee_waived = true`],
      ['weekday waived flag (direct)', `same_day_weekday_delivery_fee_waived = true`],
      ['travel waived flag (direct)', `travel_fee_waived = true`],
      ['tax waived flag (direct)', `tax_waived = true`],
      ['travel miles', `travel_total_miles = 99`],
      ['travel base radius', `travel_base_radius_miles = 3`],
      ['travel chargeable miles', `travel_chargeable_miles = 77`],
      ['travel per-mile rate', `travel_per_mile_cents = 999`],
      ['travel flat-fee flag', `travel_is_flat_fee = NOT COALESCE(travel_is_flat_fee, false)`],
    ];
    for (const [label, set] of sqlCases) await staleCase(label, {}, async (id) => { await pg.exec(`UPDATE public.orders SET ${set} WHERE id = '${id}';`); });
    // a changed set of waived amounts that is only a different JSON key order is NOT a change
    {
      const w = newWorld();
      const id = await createOrder(w, { waivers: { travel: { waived: true, reason: 'g' }, surface: { waived: true, reason: 'g' } }, items: [{ kind: 'inflatable', unit_id: U1, wet_or_dry: 'dry', qty: 1 }], eventDetails: eventBase({ surface: 'cement' }) });
      const a = await editBody(id, { adminMessage: 'order-insensitive', waivers: { travel: { waived: true, reason: 'g' }, surface: { waived: true, reason: 'g' } } });
      const stored = (await orderRow(id)).waived_fee_amounts_cents;
      await pg.exec(`UPDATE public.orders SET waived_fee_amounts_cents = '${JSON.stringify(Object.fromEntries(Object.entries(stored ?? {}).reverse()))}'::jsonb WHERE id = '${id}';`);
      const r = await call(w, a);
      ok('stale: the same waived amounts in another JSON key order are not stale', r.status === 200);
    }
    // a stored view that did not change is not stale
    {
      const w = newWorld();
      const id = await createOrder(w);
      const r = await call(w, await editBody(id, { adminMessage: 'fresh' }));
      ok('stale: an unchanged view saves', r.status === 200);
    }
    // the database enforces the waived amounts exactly (containment alone would treat {} as a subset of anything)
    {
      const w = newWorld();
      const id = await createOrder(w, { waivers: { travel: { waived: true, reason: 'g' } }, eventDetails: eventBase(), });
      await pg.exec(`UPDATE public.orders SET waived_fee_amounts_cents = '{"travel": 5000}'::jsonb WHERE id = '${id}';`);
      const state: any = await loadState(id);
      const rpc = async (cols: Record<string, unknown>) => {
        const rows = await pg.query(`SELECT public.apply_staff_order_save('${id}', 'aaaaaaaa-0000-4000-8000-${TAG}a01', ${lit({ columns: cols, children: state.children })}, '{"admin_message": "rpc"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb) AS r`, true);
        return rows?.[0]?.r?.outcome ?? JSON.stringify(rows);
      };
      eq('database: an expected waived-amount object that is only a SUBSET of the stored one is stale', await rpc({ waived_fee_amounts_cents: {} }), 'stale');
      eq('database: an expected waived-amount object with a different value is stale', await rpc({ waived_fee_amounts_cents: { travel: 1 } }), 'stale');
      eq('database: an expected NULL against stored amounts is stale', await rpc({ waived_fee_amounts_cents: null }), 'stale');
      eq('database: the exact stored object is not stale', await rpc({ waived_fee_amounts_cents: { travel: 5000 } }), 'saved');
    }
  }

  // =================================================================================================================
  // 10. The trigger is a second wall behind the privileges (it holds even if a later migration grants INSERT back)
  //     (The privileges themselves - no INSERT / UPDATE / DELETE on the three child tables, no INSERT / DELETE on orders - are proved
  //      for the real roles in coreDatabaseAccess.test.ts against a fully privileged scratch database.)
  // =================================================================================================================
  {
    // Tries a statement as a real database role and ALWAYS rolls back (the GRANTs included).
    await pg.exec(`CREATE OR REPLACE FUNCTION public.zz_try_as(p_role text, p_sub uuid, p_grant text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
      DECLARE res text;
      BEGIN
        BEGIN
          IF p_grant IS NOT NULL THEN EXECUTE p_grant; END IF;
          PERFORM set_config('request.jwt.claim.sub', COALESCE(p_sub::text, ''), true);
          PERFORM set_config('request.jwt.claim.role', p_role, true);
          EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
          BEGIN EXECUTE p_sql; res := 'OK'; EXCEPTION WHEN OTHERS THEN res := 'ERR:' || SQLSTATE; END;
          RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = res;
        EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN SQLERRM;
        END;
      END $f$;
      INSERT INTO public.user_roles (user_id, role) VALUES ('aaaaaaaa-0000-4000-8000-${TAG}a02', 'admin') ON CONFLICT DO NOTHING;`);
    const tryAs = async (role: string, who: string | null, sql: string, grant: string | null = null) => {
      const rows = await pg.query(`SELECT public.zz_try_as(${lit(role)}, ${who ? lit(`aaaaaaaa-0000-4000-8000-${TAG}${who}`) + '::uuid' : 'NULL::uuid'}, ${lit(grant)}, ${lit(sql)}) AS r`);
      return rows?.[0]?.r ?? JSON.stringify(rows);
    };
    const insertOrder = (extra: Record<string, string> = {}) => {
      const cols: Record<string, string> = {
        status: "'draft'", location_type: "'residential'", event_date: "'2031-01-01'", event_end_date: "'2031-01-01'", start_window: "'09:00'", end_window: "'17:00'", pickup_preference: "'next_day'",
        subtotal_cents: '0', deposit_due_cents: '0', balance_due_cents: '0', ...extra,
      };
      return `INSERT INTO public.orders (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).join(', ')})`;
    };
    // The hypothetical future migration that hands INSERT back to the browser roles (and the schema access they would need).
    const GRANT_BACK = 'GRANT USAGE ON SCHEMA public TO authenticated, anon; GRANT INSERT ON public.orders TO authenticated, anon; GRANT SELECT ON public.user_roles TO authenticated; GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated';
    eq('trigger: with INSERT hypothetically granted back, an Admin session can create a ZERO-valued draft (so the denials below are the trigger, not something else)', await tryAs('authenticated', 'a02', insertOrder(), GRANT_BACK), 'OK');
    for (const [label, extra] of [
      ['a subtotal', { subtotal_cents: '10000' }], ['a travel fee', { travel_fee_cents: '500' }], ['a surface fee', { surface_fee_cents: '500' }], ['a deposit', { deposit_due_cents: '100' }],
      ['a balance', { balance_due_cents: '100' }], ['tax', { tax_cents: '100' }], ['a setup fee', { setup_fee_cents: '100' }], ['a custom deposit (even 0)', { custom_deposit_cents: '0' }],
      ['travel miles', { travel_total_miles: '5' }], ['a tax waiver', { tax_waived: 'true' }], ['a travel waiver', { travel_fee_waived: 'true' }], ['a surface waiver', { surface_fee_waived: 'true' }],
      ['a generator waiver', { generator_fee_waived: 'true' }], ['a pickup waiver', { same_day_pickup_fee_waived: 'true' }], ['a weekday waiver', { same_day_weekday_delivery_fee_waived: 'true' }],
      ['waived amounts', { waived_fee_amounts_cents: "'{}'::jsonb" }], ['a paid deposit', { deposit_paid_cents: '100' }], ['a paid balance', { balance_paid_cents: '100' }], ['a tip', { tip_cents: '100' }],
      ['a damage charge', { damage_charged_cents: '100' }], ['a refund', { total_refunded_cents: '100' }], ['an Event Essentials subtotal', { event_essentials_subtotal_cents: '100' }],
      ['a weekday delivery fee', { same_day_weekday_delivery_fee_cents: '100' }], ['a generator fee', { generator_fee_cents: '100' }], ['a pickup fee', { same_day_pickup_fee_cents: '100' }],
    ] as Array<[string, Record<string, string>]>) {
      eq(`trigger: an Admin session cannot create an order with ${label}, even if INSERT were granted back`, await tryAs('authenticated', 'a02', insertOrder(extra), GRANT_BACK), 'ERR:42501');
    }
    eq('trigger: the owner / service path is not restricted (create_staff_invoice_order and create_booking_request run as the owner)', await tryAs('postgres', null, insertOrder({ subtotal_cents: '10000' })), 'OK');
    await pg.exec(`DROP FUNCTION IF EXISTS public.zz_try_as(text, uuid, text, text); DELETE FROM public.user_roles WHERE user_id = 'aaaaaaaa-0000-4000-8000-${TAG}a02';`);
  }

  // cleanup
  const ids = createdOrders.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'";
  await pg.exec(`DELETE FROM public.payments WHERE order_id IN (${ids}); DELETE FROM public.order_changelog WHERE order_id IN (${ids}); DELETE FROM public.order_items WHERE order_id IN (${ids}); DELETE FROM public.order_discounts WHERE order_id IN (${ids}); DELETE FROM public.order_custom_fees WHERE order_id IN (${ids}); DELETE FROM public.invoice_links WHERE order_id IN (${ids}); DELETE FROM public.orders WHERE id IN (${ids}); DELETE FROM public.addresses WHERE line1 LIKE '${TAG}%'; DELETE FROM public.units WHERE id IN ('${U1}', '${U2}'); DELETE FROM auth.users WHERE email LIKE 'staff-${TAG}-%@example.test';`);
  pg.close();
  finish();
})().catch((e) => {
  console.error(e);
  failed++;
  finish();
});

function finish() {
  console.log(`Staff order save tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    (globalThis as any).process.exit(1);
  }
}
