// Secure public booking creation tests.
//
// Question this suite answers: can a public customer create and complete a booking request without the browser having
// direct write authority over core customer/order tables, without trusting client-controlled item/deposit values, and
// without being charged merely for submitting the request?
//
// The create-booking pipeline (validate -> server catalog pricing -> availability -> proof -> one RPC) is exercised
// end to end against an in-memory database. The create_booking_request RPC itself is Postgres; its transaction is
// emulated here (all-or-nothing, forced defaults) and bound to the real SQL by static assertions on the migration.
// Run: node node_modules/jiti/bin/jiti.js src/lib/publicBookingSecurity.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');
const nodeCrypto = require('crypto');

import { createBookingRequest } from '../../supabase/functions/_shared/booking/createBooking';
import { eventAddressLine2 } from './eventAddress';
import { validateBookingInput } from '../../supabase/functions/_shared/booking/bookingInput';
import { buildBooking } from '../../supabase/functions/_shared/booking/bookingBuild';
import { checkPublicUnitAvailability } from '../../supabase/functions/_shared/booking/publicAvailability';
import { verifyBookingAvailability, unitsWithConflicts } from '../../supabase/functions/_shared/booking/bookingAvailability';
import {
  generateBookingToken,
  hashBookingToken,
  claimBookingProof,
  checkBookingProof,
  consumeBookingProof,
  releaseBookingProof,
  isWellFormedBookingToken,
  BOOKING_PROOF_TTL_MINUTES,
} from '../../supabase/functions/_shared/booking/bookingProof';
import { resolveReturnOrigin } from '../../supabase/functions/_shared/booking/returnOrigin';
import { validateOrderToken, proveOrderAccess } from '../../supabase/functions/_shared/auth';
import { PROOF_LINK_TYPES } from '../../supabase/functions/_shared/portal-link';
import { CUSTOMER_CONFIRM_SOURCES, evaluateCustomerConfirmation } from '../../supabase/functions/_shared/lifecycle-outcome';
import { SHARED_COPIES, renderSharedCopy } from './bookingSharedCopy';
import { calculatePrice as clientCalculatePrice } from './pricing';
import { composeUnifiedQuoteTotals as clientCompose } from './unifiedTotals';
import { calculatePrice as serverCalculatePrice } from '../../supabase/functions/_shared/booking/pricing';
import { composeUnifiedQuoteTotals as serverCompose } from '../../supabase/functions/_shared/booking/unifiedTotals';

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
const read = (p: string): string => fs.readFileSync(p, 'utf8');
const sha256 = (v: string) => nodeCrypto.createHash('sha256').update(v).digest('hex');

// ---------------------------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------------------------
const NOW = new Date('2026-10-07T12:00:00Z');
const UNIT_A = '11111111-1111-4111-8111-111111111111';
const UNIT_B = '22222222-2222-4222-8222-222222222222'; // inactive
const UNIT_C = '33333333-3333-4333-8333-333333333333';
const PROD_1 = '44444444-4444-4444-8444-444444444444';
const PROD_HIDDEN = '55555555-5555-4555-8555-555555555555';
const CAT_1 = '66666666-6666-4666-8666-666666666666';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

const RULES = {
  base_radius_miles: 20, included_city_list_json: [], per_mile_after_base_cents: 200, zone_overrides_json: [],
  surface_sandbag_fee_cents: 3000, residential_multiplier: 1, commercial_multiplier: 1.2, overnight_holiday_only: false,
  extra_day_pct: 50, generator_price_cents: 10000, deposit_per_unit_cents: 5000, same_day_pickup_fee_cents: 4000,
  same_day_weekday_delivery_fee_cents: 2500, apply_taxes_by_default: true,
  ee_only_deposit_base_threshold_cents: 20000, ee_only_deposit_base_cents: 5000, ee_only_deposit_subtotal_step_cents: 10000, ee_only_deposit_step_cents: 2500,
  event_essentials_setup_minimum_cents: 15000,
};

function makeWorld() {
  return {
    tables: {
      pricing_rules: [{ ...RULES }],
      units: [
        { id: UNIT_A, name: 'Castle', price_dry_cents: 20000, price_water_cents: 25000, active: true },
        { id: UNIT_B, name: 'Old Slide', price_dry_cents: 15000, price_water_cents: null, active: false },
        { id: UNIT_C, name: 'Combo', price_dry_cents: 30000, price_water_cents: null, active: true },
      ],
      inventory_products: [
        { id: PROD_1, name: 'Tables', category_id: CAT_1, active: true, public_visible: true },
        { id: PROD_HIDDEN, name: 'Hidden', category_id: CAT_1, active: true, public_visible: false },
      ],
      product_pricing: [
        { product_id: PROD_1, standalone_price_cents: 5000, addon_price_cents: 3000, standalone_enabled: true, addon_enabled: true, addon_qualifying_threshold_cents: null },
        { product_id: PROD_HIDDEN, standalone_price_cents: 100, addon_price_cents: 100, standalone_enabled: true, addon_enabled: true, addon_qualifying_threshold_cents: null },
      ],
      product_categories: [{ id: CAT_1 }],
      product_bundles: [] as any[],
    } as Record<string, any[]>,
    // The database the create_booking_request RPC writes to
    db: {
      customers: [
        { id: 'c-guest', email: 'guest@example.com', first_name: 'Old', last_name: 'Guest', phone: '5550000001', user_id: null, business_name: null },
        { id: 'c-owner', email: 'owner@example.com', first_name: 'Real', last_name: 'Owner', phone: '5550000002', user_id: 'u-owner', business_name: null },
      ] as any[],
      contacts: [
        { email: 'owner@example.com', first_name: 'Real', last_name: 'Owner', phone: '5550000002', business_name: 'Owner LLC', opt_in_sms: false, updated_at: '2026-01-01T00:00:00Z' },
      ] as any[],
      addresses: [] as any[],
      orders: [] as any[],
      order_items: [] as any[],
      consent_records: [] as any[],
      booking_setup_proofs: [] as any[],
      payments: [] as any[],
    } as Record<string, any[]>,
    rpcCalls: [] as any[],
    // Fault injection inside the RPC transaction
    failAt: null as string | null,
    nextId: 1,
  };
}
type World = ReturnType<typeof makeWorld>;

// TypeScript emulation of public.create_booking_request (bound to the SQL by static assertions below).
function emulateCreateBookingRequest(w: World, args: any) {
  w.rpcCalls.push(args);
  const d: Record<string, any[]> = JSON.parse(JSON.stringify(w.db));
  const step = (name: string) => {
    if (w.failAt === name) throw new Error(`injected failure at ${name}`);
  };
  try {
    const p = args.p_payload;
    const email = String(p.contact.email).toLowerCase().trim();
    let customer = d.customers.find((c) => c.email.toLowerCase() === email);
    if (!customer) {
      customer = { id: `c-${w.nextId++}`, email, first_name: p.contact.first_name, last_name: p.contact.last_name, phone: p.contact.phone, user_id: null, business_name: p.contact.business_name ?? null };
      d.customers.push(customer);
    }
    step('customer');
    // ACCOUNT BOUNDARY (mirrors the SQL): checked before the profile refresh, contacts, address, order, items, consents, proof.
    if (customer.user_id !== null && customer.user_id !== (args.p_caller_user_id ?? null)) throw new Error('account_sign_in_required');
    if (customer.user_id === null || customer.user_id === args.p_caller_user_id) {
      customer.first_name = p.contact.first_name;
      customer.last_name = p.contact.last_name;
      customer.phone = p.contact.phone;
    }
    const contact = d.contacts.find((c) => c.email === email);
    const nextContact = { email, first_name: p.contact.first_name, last_name: p.contact.last_name, phone: p.contact.phone, business_name: p.contact.business_name ?? null, opt_in_sms: true, updated_at: NOW.toISOString() };
    if (contact) Object.assign(contact, nextContact);
    else d.contacts.push(nextContact);
    step('contact');
    let address = d.addresses.find((a) => a.address_key === p.address.address_key);
    if (!address) {
      address = { id: `a-${w.nextId++}`, customer_id: customer.id, ...p.address };
      d.addresses.push(address);
    } else {
      address.customer_id = address.customer_id ?? customer.id;
      address.lat = address.lat ?? p.address.lat;
      address.lng = address.lng ?? p.address.lng;
    }
    step('address');
    const o = p.order;
    const order = {
      id: `o-${w.nextId++}`, customer_id: customer.id, address_id: address.id, event_address_line2: String(p.address.line2 ?? '').trim(), status: 'draft',
      location_type: o.location_type, surface: o.surface, event_date: o.event_date, event_end_date: o.event_end_date, pickup_preference: o.pickup_preference,
      subtotal_cents: o.subtotal_cents, tax_cents: o.tax_cents, tip_cents: o.tip_cents, setup_fee_cents: o.setup_fee_cents,
      deposit_due_cents: o.deposit_due_cents, balance_due_cents: o.balance_due_cents,
      customer_selected_payment_cents: o.customer_selected_payment_cents, customer_selected_payment_type: o.customer_selected_payment_type,
      generator_qty: 0, generator_fee_cents: 0, deposit_paid_cents: 0, balance_paid_cents: 0, total_refunded_cents: 0, custom_deposit_cents: null,
      stripe_payment_status: 'unpaid', payment_lock: false, customer_approved_at: null, admin_message: null, booking_confirmation_sent: false, cancellation_reason: null,
      tax_waived: false, travel_fee_waived: false, same_day_pickup_fee_waived: false, card_on_file_consent: true, sms_consent: true,
      special_details: o.special_details, referral_source: o.referral_source,
    };
    d.orders.push(order);
    step('order');
    for (const item of p.items) d.order_items.push({ order_id: order.id, ...item });
    step('items');
    for (const c of p.consents) d.consent_records.push({ order_id: order.id, customer_id: customer.id, ...c, ip_address: p.request_meta?.ip_address ?? null, user_agent: p.request_meta?.user_agent ?? null });
    step('consents');
    d.booking_setup_proofs.push({ id: `bp-${w.nextId++}`, order_id: order.id, token_hash: args.p_proof_hash, expires_at: args.p_proof_expires_at, claim_id: null, claimed_at: null, consumed_at: null });
    step('proof');
    w.db = d; // commit
    return { data: { order_id: order.id, customer_id: customer.id }, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e.message } }; // rollback: w.db untouched
  }
}

function makeDb(w: World) {
  return {
    from: (t: string) => ({ select: async () => ({ data: w.tables[t] ?? null, error: w.tables[t] ? null : { message: 'no table' } }) }),
    rpc: async (name: string, args: any) => (name === 'create_booking_request' ? emulateCreateBookingRequest(w, args) : { data: null, error: { message: 'unknown rpc' } }),
  };
}

function makePort(opts: { booked?: any[]; blackout?: any; blackoutFails?: boolean; productOk?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    blackout: async () => (opts.blackoutFails ? null : opts.blackout ?? { is_full_blocked: false, is_same_day_pickup_blocked: false }),
    bookedRanges: async (ids: string[]) => {
      calls.push('booked');
      return (opts.booked ?? []).filter((b) => ids.includes(b.unit_id));
    },
    productAvailability: async (items: any[]) => ({ data: items.map((i) => ({ product_id: i.product_id, is_allowed: opts.productOk !== false })), error: null }),
  };
}

const baseRequest = (over: Record<string, any> = {}): any => ({
  contact: { first_name: 'Pat', last_name: 'Lee', email: 'Pat@Example.com', phone: '5551234567' },
  event: {
    event_date: '2026-11-01', event_end_date: '2026-11-01', start_window: '09:00', end_window: '17:00', location_type: 'residential', pickup_preference: 'next_day',
    can_stake: true, distance_miles: 5, address: { line1: '1 Main St', city: 'Wayne', state: 'MI', zip: '48184', lat: 42.3, lng: -83.4 },
  },
  items: [{ type: 'inflatable', unit_id: UNIT_A, wet_or_dry: 'dry', qty: 1 }],
  consents: { sms: true, card_on_file: true },
  ...over,
});

async function book(w: World, body: any, extra: { port?: any; callerUserId?: string | null } = {}) {
  return createBookingRequest(
    { db: makeDb(w), availability: extra.port ?? makePort(), callerUserId: extra.callerUserId ?? null, meta: { ip_address: '203.0.113.7', user_agent: 'TestAgent/1.0' }, now: NOW },
    body,
  );
}
const orderRow = (w: World) => w.db.orders[w.db.orders.length - 1];
const noRows = (w: World, snapshot: string) => JSON.stringify(w.db) === snapshot;

(async () => {
  // =============================================================================================================
  // 1. Booking creation authority: a plain valid request, server-owned order defaults
  // =============================================================================================================
  {
    const w = makeWorld();
    const r = await book(w, baseRequest());
    ok('create: a valid booking request is created (200)', r.status === 200 && r.body.success === true && typeof r.body.orderId === 'string');
    const o = orderRow(w);
    ok('create: the order is a draft', o.status === 'draft');
    ok('create: nothing is paid (deposit_paid 0, balance_paid 0, refunded 0, stripe unpaid, lock off)', o.deposit_paid_cents === 0 && o.balance_paid_cents === 0 && o.total_refunded_cents === 0 && o.stripe_payment_status === 'unpaid' && o.payment_lock === false);
    ok('create: approval / alert / admin / cancel fields are safe', o.customer_approved_at === null && o.admin_message === null && o.cancellation_reason === null && o.booking_confirmation_sent === false && o.custom_deposit_cents === null);
    ok('create: waivers are off', o.tax_waived === false && o.travel_fee_waived === false && o.same_day_pickup_fee_waived === false && o.generator_qty === 0 && o.generator_fee_cents === 0);
    ok('create: the server resolved the customer by email (lower-cased) and owns the order id', o.customer_id.startsWith('c-') && typeof r.body.orderId === 'string' && r.body.orderId === o.id);
    eq('create: the contact email is stored normalized', w.db.customers.find((c) => c.id === o.customer_id).email, 'pat@example.com');
    const payload = w.rpcCalls[0].p_payload;
    const FORBIDDEN = ['status', 'customer_id', 'address_id', 'id', 'deposit_paid_cents', 'balance_paid_cents', 'total_refunded_cents', 'stripe_payment_status', 'stripe_customer_id', 'stripe_payment_method_id', 'payment_lock', 'customer_approved_at', 'admin_message', 'cancellation_reason', 'booking_confirmation_sent', 'custom_deposit_cents', 'total_cents', 'tax_waived', 'generator_qty', 'generator_fee_cents'];
    ok('create: the RPC order payload carries no status / payment / refund / approval / identity fields', FORBIDDEN.every((k) => !(k in payload.order)));
    ok('create: the RPC payload carries no customer id and no address id', !('customer_id' in payload.contact) && !('id' in payload.address) && !('customer_id' in payload.address) && !('customer_id' in payload));
    ok('create: exactly one booking proof row exists, bound to the new order', w.db.booking_setup_proofs.length === 1 && w.db.booking_setup_proofs[0].order_id === o.id);
    ok('create: no payment row, no ledger entry', w.db.payments.length === 0);
    ok('create: consent rows carry the server-derived request metadata, not client values', w.db.consent_records.length === 2 && w.db.consent_records.every((c) => c.ip_address === '203.0.113.7' && c.user_agent === 'TestAgent/1.0' && c.consented === true));
    ok('create: the consent texts and version are the fixed server copy', w.db.consent_records.some((c) => c.consent_type === 'sms' && /transactional SMS messages from Bounce Party Club LLC/.test(c.consent_text) && c.consent_version === '1.0') && w.db.consent_records.some((c) => c.consent_type === 'card_on_file' && /securely store my payment method/.test(c.consent_text)));
  }

  // =============================================================================================================
  // 2. Input allowlist: nothing identity-, money- or state-shaped is accepted
  // =============================================================================================================
  {
    const smuggles: Array<[string, (b: any) => void]> = [
      ['top-level status', (b) => (b.status = 'confirmed')],
      ['top-level order_id', (b) => (b.order_id = 'x')],
      ['top-level customer_id', (b) => (b.customer_id = 'c-owner')],
      ['top-level address_id', (b) => (b.address_id = 'a-1')],
      ['top-level total_cents', (b) => (b.total_cents = 1)],
      ['top-level deposit_due_cents', (b) => (b.deposit_due_cents = 0)],
      ['top-level deposit_paid_cents', (b) => (b.deposit_paid_cents = 99999)],
      ['contact.customer_id', (b) => (b.contact.customer_id = 'c-owner')],
      ['contact.user_id', (b) => (b.contact.user_id = 'u-owner')],
      ['event.address_id', (b) => (b.event.address_id = 'a-1')],
      ['event.status', (b) => (b.event.status = 'confirmed')],
      ['event.address.id', (b) => (b.event.address.id = 'a-1')],
      ['event.address.customer_id', (b) => (b.event.address.customer_id = 'c-owner')],
      ['event.subtotal_cents', (b) => (b.event.subtotal_cents = 1)],
      ['payment.deposit_due_cents', (b) => (b.payment = { selection_type: 'deposit', deposit_due_cents: 0 })],
      ['payment.stripe_customer_id', (b) => (b.payment = { selection_type: 'deposit', stripe_customer_id: 'cus_x' })],
      ['consents.consent_text', (b) => (b.consents.consent_text = 'x')],
      ['consents.ip_address', (b) => (b.consents.ip_address = '1.1.1.1')],
      ['items[0].order_id', (b) => (b.items[0].order_id = 'o-1')],
      ['items[0].status', (b) => (b.items[0].status = 'x')],
      ['items[0].item_name', (b) => (b.items[0].item_name = 'Free')],
      ['items[0].unit_price_override', (b) => (b.items[0].unit_price_override = 1)],
      ['referral.status', (b) => (b.referral = { status: 'x' })],
      ['billing.id', (b) => (b.billing = { same_as_event: true, id: 'x' })],
    ];
    for (const [label, mutate] of smuggles) {
      const w = makeWorld();
      const body = baseRequest();
      mutate(body);
      const before = JSON.stringify(w.db);
      const r = await book(w, body);
      ok(`allowlist: ${label} is rejected (400) and creates nothing`, r.status === 400 && noRows(w, before) && w.rpcCalls.length === 0);
    }
    const vo = validateBookingInput(baseRequest());
    ok('allowlist: the baseline request validates', vo.ok === true);
    for (const [label, mutate] of [
      ['non-boolean sms consent ("true")', (b: any) => (b.consents.sms = 'true')],
      ['numeric card consent (1)', (b: any) => (b.consents.card_on_file = 1)],
      ['missing consents object', (b: any) => delete b.consents],
      ['missing sms flag', (b: any) => delete b.consents.sms],
      ['non-integer qty', (b: any) => (b.items[0].qty = 1.5)],
      ['zero qty', (b: any) => (b.items[0].qty = 0)],
      ['huge qty', (b: any) => (b.items[0].qty = 5000)],
      ['empty items', (b: any) => (b.items = [])],
      ['non-uuid unit id', (b: any) => (b.items[0].unit_id = 'DROP TABLE')],
      ['bad email', (b: any) => (b.contact.email = 'nope')],
      ['bad date', (b: any) => (b.event.event_date = '2026-13-45')],
      ['end before start', (b: any) => ((b.event.event_date = '2026-11-05'), (b.event.event_end_date = '2026-11-01'))],
      ['30-day range', (b: any) => (b.event.event_end_date = '2026-12-20')],
      ['negative distance', (b: any) => (b.event.distance_miles = -3)],
      ['NaN distance', (b: any) => (b.event.distance_miles = NaN)],
      ['out-of-range latitude', (b: any) => (b.event.address.lat = 95)],
      ['bad location type', (b: any) => (b.event.location_type = 'industrial')],
      ['bad pickup preference', (b: any) => (b.event.pickup_preference = 'whenever')],
      ['bad time window', (b: any) => (b.event.start_window = '25:99')],
      ['non-object body', (b: any) => Object.keys(b).forEach((k) => delete b[k])],
    ] as Array<[string, (b: any) => void]>) {
      const w = makeWorld();
      const body = baseRequest();
      mutate(body);
      const r = await book(w, label === 'non-object body' ? 'nope' : body);
      ok(`validation: ${label} is rejected (400)`, r.status === 400 && w.rpcCalls.length === 0);
    }
    const w0 = makeWorld();
    ok('validation: an array body is rejected', (await book(w0, [])).status === 400);
    ok('validation: null is rejected', (await book(w0, null)).status === 400);
  }

  // =============================================================================================================
  // 3. Item price tampering: the catalog price always wins
  // =============================================================================================================
  {
    for (const claimed of [0, 1, 99999999, -5, null, undefined, 'free', 20000]) {
      const w = makeWorld();
      const body = baseRequest();
      if (claimed !== undefined) body.items[0].unit_price_cents = claimed;
      const r = await book(w, body);
      const item = w.db.order_items[0];
      ok(`price: a claimed item unit_price_cents of ${JSON.stringify(claimed)} yields the server price`, r.status === 200 && item.unit_price_cents === 20000 && orderRow(w).subtotal_cents === 20000);
    }
    {
      const w = makeWorld();
      const body = baseRequest({ items: [{ type: 'inflatable', unit_id: UNIT_A, wet_or_dry: 'water', qty: 2, unit_price_cents: 1 }] });
      const r = await book(w, body);
      ok('price: water pricing and qty come from the catalog (2 x 250.00)', r.status === 200 && w.db.order_items[0].unit_price_cents === 25000 && w.db.order_items[0].qty === 2 && orderRow(w).subtotal_cents === 50000);
    }
    {
      const w = makeWorld();
      const r = await book(w, baseRequest({ items: [{ type: 'inflatable', unit_id: UNIT_C, wet_or_dry: 'water', qty: 1 }] }));
      ok('price: a water price that does not exist for the unit is rejected', r.status === 400 && w.db.orders.length === 0);
    }
    {
      const w = makeWorld();
      const r = await book(w, baseRequest({ items: [{ type: 'inflatable', unit_id: UNIT_B, wet_or_dry: 'dry', qty: 1 }] }));
      ok('items: an inactive unit is rejected', r.status === 400 && w.db.orders.length === 0);
      const r2 = await book(w, baseRequest({ items: [{ type: 'inflatable', unit_id: UNKNOWN, wet_or_dry: 'dry', qty: 1 }] }));
      ok('items: an unknown unit is rejected', r2.status === 400 && w.db.orders.length === 0);
      const r3 = await book(w, baseRequest({ items: [{ type: 'product', product_id: UNKNOWN, qty: 1 }] }));
      ok('items: an unknown Event Essentials product is rejected', r3.status === 400 && w.db.orders.length === 0);
      const r4 = await book(w, baseRequest({ items: [{ type: 'product', product_id: PROD_HIDDEN, qty: 1 }] }));
      ok('items: a non-public product is rejected', r4.status === 400 && w.db.orders.length === 0);
      const r5 = await book(w, baseRequest({ items: [{ type: 'bundle', bundle_id: UNKNOWN, qty: 1 }] }));
      ok('items: an unknown package is rejected', r5.status === 400 && w.db.orders.length === 0);
    }
    {
      // Event Essentials: price and context come from the resolver; a $0.01 claim changes nothing
      const w = makeWorld();
      const r = await book(w, baseRequest({ items: [{ type: 'inflatable', unit_id: UNIT_A, wet_or_dry: 'dry', qty: 1 }, { type: 'product', product_id: PROD_1, qty: 2, unit_price_cents: 1 }] }));
      const ee = w.db.order_items.find((i) => i.product_id === PROD_1);
      ok('price: an Event Essentials add-on is priced by the resolver, ignoring the client', r.status === 200 && !!ee && ee.unit_price_cents === 5000 && ee.pricing_context === 'standalone' && ee.item_name === 'Tables');
      const w2 = makeWorld();
      const r2 = await book(w2, baseRequest({ items: [{ type: 'product', product_id: PROD_1, qty: 1, unit_price_cents: 1 }] }));
      const ee2 = w2.db.order_items[0];
      ok('price: an Event Essentials-only item is priced standalone by the resolver', r2.status === 200 && ee2.unit_price_cents === 5000 && ee2.pricing_context === 'standalone');
      ok('price: the Event Essentials subtotal is the resolver price x qty', w.db.orders[0].subtotal_cents === 20000 + 5000 * 2);
    }
  }

  // =============================================================================================================
  // 4. Deposit tampering: the required deposit is the server rule, never a client number
  // =============================================================================================================
  {
    for (const claimed of [0, 1, 5000, 99999999, null, -100]) {
      const w = makeWorld();
      const body = baseRequest({ payment: { selection_type: 'deposit', claimed_deposit_cents: claimed, claimed_total_cents: 1, claimed_subtotal_cents: 1 } });
      const r = await book(w, body);
      const o = orderRow(w);
      ok(`deposit: a claimed deposit of ${JSON.stringify(claimed)} yields deposit_due = 1 unit x 50.00`, r.status === 200 && o.deposit_due_cents === 5000 && o.deposit_paid_cents === 0);
    }
    const w = makeWorld();
    await book(w, baseRequest({ items: [{ type: 'inflatable', unit_id: UNIT_A, wet_or_dry: 'dry', qty: 3 }] }));
    ok('deposit: the rule scales per inflatable unit (3 x 50.00)', orderRow(w).deposit_due_cents === 15000);
    const w2 = makeWorld();
    await book(w2, baseRequest({ items: [{ type: 'product', product_id: PROD_1, qty: 1 }] }));
    ok('deposit: an Event Essentials-only order uses the EE-only deposit tier', orderRow(w2).deposit_due_cents > 0 && orderRow(w2).deposit_due_cents <= 5000 + 2500 * 10);
    const w3 = makeWorld();
    await book(w3, baseRequest({ payment: { selection_type: 'custom', selection_cents: 1 } }));
    ok('deposit: a custom payment below the deposit is clamped up to the deposit (a label only)', orderRow(w3).customer_selected_payment_cents === 5000 && orderRow(w3).deposit_paid_cents === 0);
    const w4 = makeWorld();
    await book(w4, baseRequest({ payment: { selection_type: 'custom', selection_cents: 99999999 } }));
    ok('deposit: a custom payment above the total is clamped to the total, still nothing paid', orderRow(w4).customer_selected_payment_cents < 99999999 && orderRow(w4).deposit_paid_cents === 0 && orderRow(w4).deposit_due_cents === 5000);
    const w5 = makeWorld();
    const r5 = await book(w5, baseRequest({ payment: { selection_type: 'deposit', tip_cents: 99999999 } }));
    ok('deposit: a tip larger than the order total is rejected', r5.status === 400 && w5.db.orders.length === 0);
    const w6 = makeWorld();
    await book(w6, baseRequest({ payment: { selection_type: 'deposit', tip_cents: 1500 } }));
    ok('deposit: a reasonable tip is stored as a tip only (never added to the deposit)', orderRow(w6).tip_cents === 1500 && orderRow(w6).deposit_due_cents === 5000);
  }

  // =============================================================================================================
  // 5. Customer and address resolution
  // =============================================================================================================
  {
    const w = makeWorld();
    await book(w, baseRequest({ contact: { first_name: 'New', last_name: 'Person', email: 'brand-new@example.com', phone: '5559990000' } }));
    ok('customer: a NEW guest creates a customer record', w.db.customers.length === 3 && w.db.customers.some((c) => c.email === 'brand-new@example.com' && c.first_name === 'New'));

    const w2 = makeWorld();
    await book(w2, baseRequest({ contact: { first_name: 'Updated', last_name: 'Guest', email: 'GUEST@example.com', phone: '5559991111' } }));
    const g = w2.db.customers.find((c) => c.id === 'c-guest');
    ok('customer: an EXISTING guest record is matched case-insensitively and its profile refreshed (unchanged behaviour)', w2.db.customers.length === 2 && g.first_name === 'Updated' && g.phone === '5559991111' && orderRow(w2).customer_id === 'c-guest');

    // ---- registered-account boundary ----
    const PII = ['Real', 'Owner', '5550000002', 'Owner LLC', 'c-owner', 'u-owner', 'owner@example.com'];
    const collide = async (callerUserId: string | null, label: string) => {
      const w = makeWorld();
      const before = JSON.stringify(w.db);
      const r = await book(w, baseRequest({ contact: { first_name: 'Mal', last_name: 'Lory', email: 'Owner@Example.com', phone: '5558880000', business_name: 'Evil Inc' } }), { callerUserId });
      ok(`account: ${label} is rejected with 403 ACCOUNT_SIGN_IN_REQUIRED`, r.status === 403 && r.body.code === 'ACCOUNT_SIGN_IN_REQUIRED' && r.body.success === false);
      ok(`account: ${label} - zero side effects (no order, items, consents, proof, address, customer change)`, noRows(w, before) && w.db.orders.length === 0 && w.db.booking_setup_proofs.length === 0 && w.db.consent_records.length === 0 && w.db.order_items.length === 0 && w.db.addresses.length === 0);
      ok(`account: ${label} - the registered customer row is unchanged`, JSON.stringify(w.db.customers.find((c) => c.id === 'c-owner')) === JSON.stringify(JSON.parse(before).customers.find((c: any) => c.id === 'c-owner')));
      const contact = w.db.contacts.find((c) => c.email === 'owner@example.com');
      ok(`account: ${label} - the CRM contact record is untouched (names, phone, business, opt-in, updated_at)`, contact.first_name === 'Real' && contact.last_name === 'Owner' && contact.phone === '5550000002' && contact.business_name === 'Owner LLC' && contact.opt_in_sms === false && contact.updated_at === '2026-01-01T00:00:00Z');
      const text = JSON.stringify(r.body);
      ok(`account: ${label} - the response contains none of the account data and no token / order id`, PII.every((x) => !text.includes(x)) && !('orderId' in r.body) && !('bookingToken' in r.body) && !('customer_id' in r.body));
      ok(`account: ${label} - the RPC was the authority (it was called and refused)`, w.rpcCalls.length === 1);
      ok(`account: ${label} - the response has exactly success / error / code and nothing else`, JSON.stringify(Object.keys(r.body).sort()) === JSON.stringify(['code', 'error', 'success']));
    };
    await collide(null, 'an ANONYMOUS caller using a registered customer email');
    await collide('u-someone-else', 'a DIFFERENT signed-in customer using that email');

    const w4 = makeWorld();
    const own = await book(w4, baseRequest({ contact: { first_name: 'Real', last_name: 'Owner2', email: 'owner@example.com', phone: '5557770000' } }), { callerUserId: 'u-owner' });
    ok('account: the correct signed-in owner using their own email succeeds and attaches to their customer row', own.status === 200 && orderRow(w4).customer_id === 'c-owner' && w4.db.customers.length === 2);
    ok('account: the owner keeps the legitimate profile refresh and contact refresh', w4.db.customers.find((c) => c.id === 'c-owner').last_name === 'Owner2' && w4.db.contacts.find((c) => c.email === 'owner@example.com').phone === '5557770000');

    // Existing GUEST customers (user_id IS NULL) keep their behaviour
    const w5 = makeWorld();
    const guestAnon = await book(w5, baseRequest({ contact: { first_name: 'Updated', last_name: 'Guest', email: 'guest@example.com', phone: '5559992222' } }));
    ok('account: an existing GUEST customer (no login) still works for an anonymous booking', guestAnon.status === 200 && orderRow(w5).customer_id === 'c-guest' && w5.db.customers.find((c) => c.id === 'c-guest').phone === '5559992222');
    const w5b = makeWorld();
    const guestSigned = await book(w5b, baseRequest({ contact: { first_name: 'G', last_name: 'G', email: 'guest@example.com', phone: '5559993333' } }), { callerUserId: 'u-anyone' });
    ok('account: a guest record is also usable by a signed-in caller (unchanged behaviour)', guestSigned.status === 200 && orderRow(w5b).customer_id === 'c-guest');

    // The authoritative rule lives in the RPC, before every side-effecting write (static binding of the emulation to the SQL)
    const sqlText = read('supabase/migrations/20261011120000_order_event_address_line2.sql');
    const raise = sqlText.indexOf("RAISE EXCEPTION 'account_sign_in_required'");
    ok('account (SQL): the rejection exists with the exact guard condition', raise > 0 && sqlText.includes("IF v_customer_uid IS NOT NULL AND v_customer_uid IS DISTINCT FROM p_caller_user_id THEN\n    RAISE EXCEPTION 'account_sign_in_required';"));
    ok('account (SQL): the rejection comes BEFORE the profile update, contacts, addresses, orders, items, consents and proof writes', ['UPDATE customers', 'INSERT INTO contacts', 'INSERT INTO addresses', 'INSERT INTO orders', 'INSERT INTO order_items', 'INSERT INTO consent_records', 'INSERT INTO booking_setup_proofs'].every((t) => sqlText.indexOf(t) > raise));
    ok('account (SQL): IS DISTINCT FROM treats a NULL (anonymous) caller as a mismatch', !/v_customer_uid <> p_caller_user_id|v_customer_uid != p_caller_user_id/.test(sqlText));
    ok('account (SQL): the Edge Function relies on the RPC (no separate lookup of customers)', !/from\("customers"\)/.test(read('supabase/functions/_shared/booking/createBooking.ts')) && /account_sign_in_required/.test(read('supabase/functions/_shared/booking/createBooking.ts')));
    ok('account: the browser shows the sign-in message and does not retry', /ACCOUNT_SIGN_IN_REQUIRED/.test(read('src/pages/Checkout.tsx')) && /BookingApiError/.test(read('src/lib/bookingApi.ts')));

    // address: server derives the key, the existing canonical address keeps owner and coordinates
    const w6 = makeWorld();
    await book(w6, baseRequest());
    const first = w6.db.addresses[0];
    await book(w6, baseRequest({ contact: { first_name: 'Other', last_name: 'Person', email: 'someone-else@example.com', phone: '5554440000' }, event: { ...baseRequest().event, address: { line1: '1 MAIN ST ', city: 'wayne', state: 'mi', zip: '48 184', lat: 10, lng: 10 } } }));
    ok('address: the same address in a different spelling resolves to ONE canonical row', w6.db.addresses.length === 1);
    ok('address: the existing row keeps its first owner and its coordinates (not repointed / overwritten)', w6.db.addresses[0].customer_id === first.customer_id && w6.db.addresses[0].lat === 42.3 && w6.db.addresses[0].lng === -83.4);
    ok('address: the address key is derived by the server', w6.rpcCalls[0].p_payload.address.address_key === '1 main st|wayne|MI|48184');
  }

  // =============================================================================================================
  // 6. Availability
  // =============================================================================================================
  {
    const booked = (status: string, d1 = '2026-11-01', d2: string | null = '2026-11-01', unit = UNIT_A) => [{ unit_id: unit, event_date: d1, event_end_date: d2, status }];
    const cases: Array<[string, any, boolean]> = [
      ['a pending_review booking blocks', booked('pending_review'), false],
      ['a confirmed booking blocks', booked('confirmed'), false],
      ['an awaiting_customer_approval booking blocks', booked('awaiting_customer_approval'), false],
      ['an approved booking blocks', booked('approved'), false],
      ['an in_progress booking blocks', booked('in_progress'), false],
      ['a completed booking blocks', booked('completed'), false],
      ['a CANCELLED booking does not block', booked('cancelled'), true],
      ['a void booking does not block', booked('void'), true],
      ['a DRAFT booking does not block', booked('draft'), true],
      ['a different unit does not block', booked('confirmed', '2026-11-01', '2026-11-01', UNIT_C), true],
      ['a different date does not block', booked('confirmed', '2026-11-03', '2026-11-03'), true],
      ['an overlapping multi-day booking blocks', booked('confirmed', '2026-10-30', '2026-11-02'), false],
      ['a booking ending the day before does not block', booked('confirmed', '2026-10-30', '2026-10-31'), true],
      ['a booking with no end date is treated as a single day', booked('confirmed', '2026-11-01', null), false],
    ];
    for (const [label, ranges, expectOk] of cases) {
      const w = makeWorld();
      const r = await book(w, baseRequest(), { port: makePort({ booked: ranges }) });
      ok(`availability: ${label}`, expectOk ? r.status === 200 : r.status === 409 && r.body.code === 'UNITS_UNAVAILABLE' && w.db.orders.length === 0);
    }
    {
      const w = makeWorld();
      const r = await book(w, baseRequest(), { port: makePort({ blackout: { is_full_blocked: true, is_same_day_pickup_blocked: false } }) });
      ok('availability: a blacked-out date is rejected (409) and nothing is created', r.status === 409 && r.body.code === 'DATE_BLACKED_OUT' && w.db.orders.length === 0);
      const w2 = makeWorld();
      const r2 = await book(w2, baseRequest({ event: { ...baseRequest().event, pickup_preference: 'same_day' } }), { port: makePort({ blackout: { is_full_blocked: false, is_same_day_pickup_blocked: true } }) });
      ok('availability: a same-day-pickup blackout rejects same-day pickups', r2.status === 409 && r2.body.code === 'SAME_DAY_PICKUP_BLACKED_OUT');
      const w3 = makeWorld();
      const r3 = await book(w3, baseRequest(), { port: makePort({ blackout: { is_full_blocked: false, is_same_day_pickup_blocked: true } }) });
      ok('availability: a same-day-pickup blackout does not reject next-day pickups', r3.status === 200);
      const w4 = makeWorld();
      const r4 = await book(w4, baseRequest({ event: { ...baseRequest().event, location_type: 'commercial' } }), { port: makePort({ blackout: { is_full_blocked: false, is_same_day_pickup_blocked: true } }) });
      ok('availability: commercial orders count as same-day for the pickup blackout', r4.status === 409);
      const w5 = makeWorld();
      const r5 = await book(w5, baseRequest(), { port: makePort({ blackoutFails: true }) });
      ok('availability: an unreadable blackout lookup fails CLOSED (503), nothing created', r5.status === 503 && w5.db.orders.length === 0);
      const w6 = makeWorld();
      const brokenPort = { ...makePort(), bookedRanges: async () => null };
      const r6 = await book(w6, baseRequest(), { port: brokenPort });
      ok('availability: an unreadable bookings lookup fails CLOSED (503), nothing created', r6.status === 503 && w6.db.orders.length === 0);
      const w7 = makeWorld();
      const r7 = await book(w7, baseRequest({ items: [{ type: 'product', product_id: PROD_1, qty: 1 }] }), { port: makePort({ productOk: false }) });
      ok('availability: Event Essentials stock is verified server-side (409 when not allowed)', r7.status === 409 && r7.body.code === 'ITEMS_UNAVAILABLE' && w7.db.orders.length === 0);
      const w8 = makeWorld();
      const r8 = await book(w8, baseRequest(), { port: makePort({ booked: booked('confirmed') }) });
      ok('availability: the error response carries no order, customer or address information', r8.status === 409 && !/order|customer|address|email|pending|confirmed/i.test(JSON.stringify({ ...r8.body, error: '' })) && JSON.stringify(Object.keys(r8.body).sort()) === JSON.stringify(['code', 'error', 'success', 'unitIds']));
      const w9 = makeWorld();
      const r9 = await book(w9, baseRequest({ event: { ...baseRequest().event, event_date: '2026-10-06', event_end_date: '2026-10-06' } }));
      ok('availability: an event date in the past is rejected', r9.status === 400 && w9.db.orders.length === 0);
    }
    ok('availability: unitsWithConflicts ignores units that were not asked about', unitsWithConflicts(booked('confirmed'), [UNIT_C], '2026-11-01', '2026-11-01').length === 0);

    // Public endpoint: booleans only
    const port = makePort({ booked: booked('confirmed') });
    const ep = await checkPublicUnitAvailability(port as any, { checks: [{ unitId: UNIT_A, eventStartDate: '2026-11-01', eventEndDate: '2026-11-01' }, { unitId: UNIT_C, eventStartDate: '2026-11-01', eventEndDate: '2026-11-01' }] });
    ok('public availability: returns a boolean per unit', ep.status === 200 && JSON.stringify(ep.body) === JSON.stringify({ success: true, results: [{ unitId: UNIT_A, isAvailable: false }, { unitId: UNIT_C, isAvailable: true }] }));
    ok('public availability: the response has no order / customer / address / status / date fields', !/orderId|order_id|customer|address|status|confirmed|event_date|conflict/i.test(JSON.stringify(ep.body)));
    const epCancelled = await checkPublicUnitAvailability(makePort({ booked: booked('cancelled') }) as any, { checks: [{ unitId: UNIT_A, eventStartDate: '2026-11-01' }] });
    ok('public availability: a cancelled order does not block', (epCancelled.body.results as any[])[0].isAvailable === true);
    const epBlackout = await checkPublicUnitAvailability(makePort({ blackout: { is_full_blocked: true, is_same_day_pickup_blocked: false } }) as any, { checks: [{ unitId: UNIT_C, eventStartDate: '2026-11-01' }] });
    ok('public availability: a blackout date reports unavailable', (epBlackout.body.results as any[])[0].isAvailable === false);
    const epFail = await checkPublicUnitAvailability(makePort({ blackoutFails: true }) as any, { checks: [{ unitId: UNIT_C, eventStartDate: '2026-11-01' }] });
    ok('public availability: an unverifiable lookup reports unavailable (fails closed)', (epFail.body.results as any[])[0].isAvailable === false);
    for (const bad of [null, {}, { checks: [] }, { checks: 'x' }, { checks: [{ unitId: 'nope', eventStartDate: '2026-11-01' }] }, { checks: [{ unitId: UNIT_A, eventStartDate: 'x' }] }, { checks: [{ unitId: UNIT_A, eventStartDate: '2026-11-02', eventEndDate: '2026-11-01' }] }, { checks: new Array(61).fill({ unitId: UNIT_A, eventStartDate: '2026-11-01' }) }]) {
      ok(`public availability: invalid request ${JSON.stringify(bad)?.slice(0, 40)} is rejected`, (await checkPublicUnitAvailability(makePort() as any, bad)).status === 400);
    }
    const verdict = await verifyBookingAvailability(makePort() as any, { unitIds: [], eeItems: [], startDate: '2026-11-01', endDate: '2026-11-01' });
    ok('public availability: the shared verifier accepts an empty requirement', verdict.ok === true);
  }

  // =============================================================================================================
  // 7. Atomic creation
  // =============================================================================================================
  {
    for (const failAt of ['customer', 'contact', 'address', 'order', 'items', 'consents', 'proof']) {
      const w = makeWorld();
      w.failAt = failAt;
      const before = JSON.stringify(w.db);
      const r = await book(w, baseRequest());
      ok(`atomic: a failure while writing ${failAt} leaves NO partial booking (no customer, address, order, items, consents or proof)`, r.status === 500 && noRows(w, before));
      ok(`atomic: after a ${failAt} failure the caller gets no order id and no booking proof`, !('orderId' in r.body) && !('bookingToken' in r.body));
    }
    const w = makeWorld();
    w.failAt = null;
    const okRun = await book(w, baseRequest());
    ok('atomic: with no fault the same request commits everything together', okRun.status === 200 && w.db.orders.length === 1 && w.db.order_items.length === 1 && w.db.consent_records.length === 2 && w.db.booking_setup_proofs.length === 1);
    const createSrc = read('supabase/functions/_shared/booking/createBooking.ts') + read('supabase/functions/create-booking/index.ts');
    ok('atomic: the TypeScript never writes a core table itself — only the single RPC does', !/\.from\(\s*['"](customers|addresses|orders|order_items|consent_records|contacts|booking_setup_proofs|payments)['"]\s*\)[\s\S]{0,40}\.(insert|update|upsert|delete)/.test(createSrc) && (createSrc.match(/\.rpc\(/g) ?? []).length === 1);
    const sql = read('supabase/migrations/20261011120000_order_event_address_line2.sql');
    ok('atomic: the RPC is one plpgsql function with no transaction control', /CREATE OR REPLACE FUNCTION public\.create_booking_request/.test(sql) && !/\bCOMMIT\b|\bROLLBACK\b|BEGIN;|SAVEPOINT/i.test(sql.replace(/^\s*BEGIN\s*$/gim, '')));
    ok('atomic: customer, address, order, items, consents and proof are all inserted by that one function', ['INSERT INTO customers', 'INSERT INTO addresses', 'INSERT INTO orders', 'INSERT INTO order_items', 'INSERT INTO consent_records', 'INSERT INTO booking_setup_proofs'].every((s) => sql.includes(s)));
  }

  // =============================================================================================================
  // 8. Booking proof design
  // =============================================================================================================
  {
    const w = makeWorld();
    const r = await book(w, baseRequest());
    const token = r.body.bookingToken as string;
    ok('proof: the token is server-generated, well-formed and high entropy', typeof token === 'string' && isWellFormedBookingToken(token) && token.length >= 46);
    const tokens = new Set(Array.from({ length: 200 }, () => generateBookingToken()));
    ok('proof: 200 generated tokens are all distinct', tokens.size === 200);
    ok('proof: the stored value is the SHA-256 hash, not the token', w.db.booking_setup_proofs[0].token_hash === sha256(token) && w.db.booking_setup_proofs[0].token_hash === (await hashBookingToken(token)));
    ok('proof: the plaintext token is never persisted anywhere in the database', !JSON.stringify(w.db).includes(token));
    const ttl = new Date(w.db.booking_setup_proofs[0].expires_at).getTime() - NOW.getTime();
    ok('proof: it expires in 30 minutes by default', BOOKING_PROOF_TTL_MINUTES === 30 && ttl === 30 * 60_000);
    ok('proof: it is bound to exactly the new order', w.db.booking_setup_proofs[0].order_id === r.body.orderId);
    const other = await book(w, baseRequest({ contact: { first_name: 'Two', last_name: 'Two', email: 'two@example.com', phone: '5551110000' } }));
    ok('proof: two bookings get two different tokens and hashes', other.body.bookingToken !== token && w.db.booking_setup_proofs[0].token_hash !== w.db.booking_setup_proofs[1].token_hash);

    // The proof is checked against its own order only
    const dbClient = fakeProofDb(w.db.booking_setup_proofs);
    const orderA = r.body.orderId as string;
    const orderB = other.body.orderId as string;
    ok('proof: Order A\'s proof validates for Order A', (await checkBookingProof(dbClient, orderA, token, NOW)).ok === true);
    ok('proof: Order A\'s proof does NOT validate for Order B', (await checkBookingProof(dbClient, orderB, token, NOW)).ok === false);
    ok('proof: a raw order UUID is not a proof', (await checkBookingProof(dbClient, orderA, orderA, NOW)).ok === false);
    ok('proof: an empty / garbage token is not a proof', (await checkBookingProof(dbClient, orderA, '', NOW)).ok === false && (await checkBookingProof(dbClient, orderA, 'bk_short', NOW)).ok === false && (await checkBookingProof(dbClient, orderA, undefined, NOW)).ok === false);
    const expired = await checkBookingProof(dbClient, orderA, token, new Date(NOW.getTime() + 31 * 60_000));
    ok('proof: after 30 minutes the proof is expired', expired.ok === false && (expired as any).reason === 'expired');

    // Proof isolation from portal / invoice links
    ok('proof: ORDER_PROOF_LINK_TYPES still contain only portal and invoice', JSON.stringify(PROOF_LINK_TYPES) === JSON.stringify(['portal', 'invoice']));
    const links: any[] = [{ order_id: orderA, link_type: 'invoice', link_token: 'a'.repeat(64), expires_at: new Date(NOW.getTime() + 86_400_000).toISOString() }];
    const linkClient = fakeLinkClient(links);
    ok('proof: the booking proof is NOT accepted as a portal/invoice token', (await validateOrderToken(linkClient, orderA, token, NOW)) === false);
    ok('proof: the booking proof is NOT accepted by proveOrderAccess', (await proveOrderAccess(linkClient, { orderId: orderA, caller: { kind: 'anonymous' }, token, now: NOW })) === null);
    ok('proof: an invoice/portal token is NOT accepted as a booking proof', (await checkBookingProof(dbClient, orderA, 'a'.repeat(64), NOW)).ok === false);
    const sql = read('supabase/migrations/20261010120000_secure_public_booking_creation.sql');
    ok('proof: booking proofs live in their own table, not invoice_links', /CREATE TABLE IF NOT EXISTS public\.booking_setup_proofs/.test(sql) && !/INSERT INTO invoice_links/.test(sql));
    ok('proof: the proof table is service-role only (RLS on, no policies, browser roles revoked)', /ALTER TABLE public\.booking_setup_proofs ENABLE ROW LEVEL SECURITY/.test(sql) && !/CREATE POLICY[^;]*booking_setup_proofs/i.test(sql) && /REVOKE ALL ON public\.booking_setup_proofs FROM anon/.test(sql) && /REVOKE ALL ON public\.booking_setup_proofs FROM authenticated/.test(sql) && /REVOKE ALL ON public\.booking_setup_proofs FROM PUBLIC/.test(sql));
    ok('proof: one proof per order and unique hashes (single mint)', /UNIQUE \(order_id\)/.test(sql) && /UNIQUE \(token_hash\)/.test(sql));
  }

  // =============================================================================================================
  // 9. Proof consumption: claim -> consume / release, concurrency, retry
  // =============================================================================================================
  {
    const mk = async () => {
      const token = generateBookingToken();
      const rows: any[] = [{ id: 'bp-1', order_id: 'ord-1', token_hash: await hashBookingToken(token), expires_at: new Date(NOW.getTime() + 30 * 60_000).toISOString(), claim_id: null, claimed_at: null, consumed_at: null }];
      return { token, rows, db: fakeProofDb(rows) };
    };
    {
      const { token, rows, db } = await mk();
      const claim: any = await claimBookingProof(db, 'ord-1', token, NOW);
      ok('consume: a valid proof can be claimed', claim.ok === true);
      ok('consume: claiming does not consume it yet', rows[0].consumed_at === null && rows[0].claim_id === claim.claimId);
      ok('consume: a second claim while the first is in flight is refused (busy)', (await claimBookingProof(db, 'ord-1', token, NOW) as any).reason === 'busy');
      await releaseBookingProof(db, claim.proofId, claim.claimId);
      ok('consume: releasing after a Stripe failure clears the claim and keeps the proof unconsumed', rows[0].claim_id === null && rows[0].consumed_at === null);
      const retry: any = await claimBookingProof(db, 'ord-1', token, NOW);
      ok('consume: the same proof can be claimed again after a failure (retry)', retry.ok === true);
      ok('consume: consuming with the wrong claim id is refused', (await consumeBookingProof(db, retry.proofId, 'someone-else', NOW)) === false && rows[0].consumed_at === null);
      ok('consume: consuming with the right claim id succeeds', (await consumeBookingProof(db, retry.proofId, retry.claimId, NOW)) === true && !!rows[0].consumed_at);
      ok('consume: a consumed proof can never be claimed again', (await claimBookingProof(db, 'ord-1', token, NOW) as any).reason === 'consumed');
      ok('consume: a consumed proof cannot be consumed twice', (await consumeBookingProof(db, retry.proofId, retry.claimId, NOW)) === false);
    }
    {
      const { token, db } = await mk();
      const results = await Promise.all(Array.from({ length: 12 }, () => claimBookingProof(db, 'ord-1', token, NOW)));
      ok('consume: 12 concurrent claims of one proof produce exactly ONE winner', results.filter((x: any) => x.ok).length === 1);
    }
    {
      const { token, rows, db } = await mk();
      const first: any = await claimBookingProof(db, 'ord-1', token, NOW);
      const later = new Date(NOW.getTime() + 3 * 60_000);
      const takeover: any = await claimBookingProof(db, 'ord-1', token, later);
      ok('consume: a STALE claim (crashed request) can be taken over after the stale window', first.ok && takeover.ok && takeover.claimId !== first.claimId && rows[0].claim_id === takeover.claimId);
      ok('consume: the original (stale) claimant can no longer consume', (await consumeBookingProof(db, first.proofId, first.claimId, later)) === false);
    }
    {
      const { token, db } = await mk();
      const afterExpiry = new Date(NOW.getTime() + 31 * 60_000);
      ok('consume: an expired proof cannot be claimed', (await claimBookingProof(db, 'ord-1', token, afterExpiry) as any).reason === 'expired');
      ok('consume: the wrong order cannot claim it', (await claimBookingProof(db, 'ord-2', token, NOW) as any).reason === 'invalid');
    }
  }

  // =============================================================================================================
  // 10. No-charge invariant
  // =============================================================================================================
  {
    const createSources = ['supabase/functions/create-booking/index.ts', 'supabase/functions/_shared/booking/createBooking.ts', 'supabase/functions/_shared/booking/bookingBuild.ts', 'supabase/functions/_shared/booking/bookingProof.ts', 'supabase/functions/_shared/booking/bookingAvailability.ts', 'supabase/functions/check-availability/index.ts', 'supabase/functions/complete-booking/index.ts'].map((f) => [f, read(f)] as const);
    for (const [f, src] of createSources) {
      const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      ok(`no-charge: ${f} never creates a PaymentIntent, charge, refund or payment-mode session`, !/paymentIntents|charges\.create|refunds\.create|mode:\s*["']payment["']|checkout\.sessions\.create/.test(code));
      ok(`no-charge: ${f} never writes a payment or ledger row or a deposit amount`, !/from\(\s*["']payments["']\s*\)|deposit_paid_cents\s*[:=]\s*[1-9]|record_cash_payment|apply_balance_payment_financials/.test(code));
    }
    const sql = read('supabase/migrations/20261011120000_order_event_address_line2.sql');
    ok('no-charge: the RPC writes deposit_paid_cents = 0, balance_paid = 0, refunded = 0 as literals', /tip_cents, deposit_due_cents, deposit_paid_cents, balance_due_cents, balance_paid_cents, total_refunded_cents/.test(sql) && /\(v_order->>'tip_cents'\)::integer, \(v_order->>'deposit_due_cents'\)::integer, 0, \(v_order->>'balance_due_cents'\)::integer, 0, 0, NULL/.test(sql));
    ok('no-charge: the RPC writes status as the literal draft and never reads a status from the payload', /v_customer_id, v_address_id, COALESCE\(btrim\(v_address->>'line2'\), ''\), 'draft'/.test(sql) && !/v_order->>'status'|p_payload->>'status'/.test(sql));
    ok('no-charge: the RPC forces stripe_payment_status unpaid, payment_lock false, customer_approved_at NULL', /'unpaid', false, NULL/.test(sql));
    const checkout = read('supabase/functions/stripe-checkout/index.ts');
    const bookingParams = checkout.slice(checkout.indexOf('const sessionParams'), checkout.indexOf('? {', checkout.indexOf('const sessionParams')) + 400);
    ok('no-charge: the booking-mode Stripe session is mode "setup" with no line items', /bookingMode\s*\?\s*\{[\s\S]{0,200}mode:\s*"setup"/.test(checkout) && !/bookingMode\s*\?\s*\{[\s\S]{0,400}line_items/.test(bookingParams));
    ok('no-charge: the booking session metadata says booking_request', /payment_type:\s*"booking_request"/.test(checkout));
    ok('no-charge: a deposit is only ever charged by the separate admin/lifecycle paths (not create/complete-booking)', !/charge-deposit/.test(createSources.map((x) => x[1]).join('\n')));
    ok('no-charge: the browser booking API never calls a charge endpoint', !/charge-deposit|stripe-charge|customer-balance-payment|stripe-refund/.test(read('src/lib/bookingApi.ts')));
  }

  // =============================================================================================================
  // 11. Static: the isFreshBookingDraft authorization is gone
  // =============================================================================================================
  {
    const files = fs.readdirSync('supabase/functions/_shared').filter((f: string) => f.endsWith('.ts')).map((f: string) => `supabase/functions/_shared/${f}`).concat(fs.readdirSync('supabase/functions').filter((d: string) => fs.existsSync(`supabase/functions/${d}/index.ts`)).map((d: string) => `supabase/functions/${d}/index.ts`));
    ok('legacy auth: nothing under supabase/functions references isFreshBookingDraft or FRESH_BOOKING_DRAFT_WINDOW_MS', files.every((f: string) => !/isFreshBookingDraft|FRESH_BOOKING_DRAFT/.test(read(f))));
    const checkout = read('supabase/functions/stripe-checkout/index.ts');
    ok('legacy auth: stripe-checkout authorizes booking mode only by the booking proof (or staff)', /checkBookingProof\(/.test(checkout) && /claimBookingProof\(/.test(checkout) && /consumeBookingProof\(/.test(checkout) && /releaseBookingProof\(/.test(checkout) && !/accept:\s*\[[^\]]*\]\s*,?\s*\}\);\s*authorizedToCreate = !!proof;[\s\S]{0,40}bookingMode === true\)/.test(checkout));
    ok('legacy auth: a portal/invoice token cannot start a booking-mode session (token proof is skipped in booking mode)', /!authorizedToCreate && bookingMode !== true/.test(checkout));
    ok('legacy auth: stripe-checkout no longer takes the customer, deposit or tip from the booking request body', /bookingMode === true\)[\s\S]{0,600}sessionDepositCents = typeof order\.deposit_due_cents/.test(checkout));
    ok('legacy auth: Stripe return URLs are built from an allowlisted origin', /resolveReturnOrigin\(/.test(checkout) && !/headerOrigin \|\| bodyOrigin/.test(checkout));
  }

  // =============================================================================================================
  // 12. Return origin allowlist
  // =============================================================================================================
  {
    eq('origin: production is allowed', resolveReturnOrigin(['https://bouncepartyclub.com']), 'https://bouncepartyclub.com');
    eq('origin: www is allowed', resolveReturnOrigin(['https://www.bouncepartyclub.com/x?y=1']), 'https://www.bouncepartyclub.com');
    eq('origin: localhost dev is allowed', resolveReturnOrigin(['http://localhost:5173']), 'http://localhost:5173');
    eq('origin: an unknown site falls back to production', resolveReturnOrigin(['https://evil.example']), 'https://bouncepartyclub.com');
    eq('origin: a lookalike host falls back', resolveReturnOrigin(['https://bouncepartyclub.com.evil.example']), 'https://bouncepartyclub.com');
    eq('origin: javascript: and data: URLs fall back', resolveReturnOrigin(['javascript:alert(1)', 'data:text/html,x']), 'https://bouncepartyclub.com');
    eq('origin: credentials in the URL fall back', resolveReturnOrigin(['https://user:pw@bouncepartyclub.com']), 'https://bouncepartyclub.com');
    eq('origin: http (non-loopback) production is not allowed', resolveReturnOrigin(['http://bouncepartyclub.com']), 'https://bouncepartyclub.com');
    eq('origin: an unknown header origin does not block a valid body origin', resolveReturnOrigin(['https://evil.example', 'https://www.bouncepartyclub.com']), 'https://www.bouncepartyclub.com');
    eq('origin: a configured https SITE_URL / RETURN_ORIGINS entry is allowed', resolveReturnOrigin(['https://staging.example.com'], [undefined, 'https://staging.example.com, https://other.example.com']), 'https://staging.example.com');
    eq('origin: a configured http origin is NOT allowed', resolveReturnOrigin(['http://staging.example.com'], ['http://staging.example.com']), 'https://bouncepartyclub.com');
    eq('origin: nothing at all falls back', resolveReturnOrigin([null, undefined, 42]), 'https://bouncepartyclub.com');
  }

  // =============================================================================================================
  // 13. Server pricing parity with the Quote / Checkout code (generated copies + drift)
  // =============================================================================================================
  {
    for (const spec of SHARED_COPIES) {
      const expected = renderSharedCopy(spec, read(spec.source));
      const actual = read(`supabase/functions/_shared/booking/${spec.out}`).replace(/\r\n/g, '\n');
      ok(`drift: _shared/booking/${spec.out} matches ${spec.source}`, expected === actual);
    }
    const rules: any = { ...RULES };
    const mkInput = (over: Record<string, unknown> = {}): any => ({ items: [{ unit_id: UNIT_A, wet_or_dry: 'dry', unit_price_cents: 20000, qty: 2 }], location_type: 'residential', surface: 'cement', can_use_stakes: false, overnight_allowed: true, num_days: 2, distance_miles: 33, city: 'Wayne', zip: '48184', has_generator: false, generator_qty: 0, rules, is_same_day_weekday_delivery: false, ...over });
    for (const over of [{}, { location_type: 'commercial' }, { overnight_allowed: false }, { num_days: 4 }, { distance_miles: 0 }, { distance_miles: 80 }, { surface: 'grass', can_use_stakes: true }, { is_same_day_weekday_delivery: true }]) {
      eq(`parity: server calculatePrice == client calculatePrice for ${JSON.stringify(over)}`, serverCalculatePrice(mkInput(over)), clientCalculatePrice(mkInput(over)));
    }
    const cart: any[] = [{ item_type: 'inflatable', unit_id: UNIT_A, unit_name: 'C', wet_or_dry: 'dry', unit_price_cents: 20000, qty: 2 }, { item_type: 'event_essential_product', product_id: PROD_1, product_name: 'T', unit_price_cents: 3000, qty: 2, pricing_context: 'addon' }];
    const bd = clientCalculatePrice(mkInput());
    const compIn: any = { inflatableBreakdown: bd, cart, taxApplied: true, eeOnlyDepositSettings: { eeOnlyDepositBaseThresholdCents: 20000, eeOnlyDepositBaseCents: 5000, eeOnlyDepositSubtotalStepCents: 10000, eeOnlyDepositStepCents: 2500 }, inflatableDepositPerUnitCents: 5000, setupMinimumCents: 15000 };
    eq('parity: server composeUnifiedQuoteTotals == client composeUnifiedQuoteTotals', serverCompose(compIn), clientCompose(compIn));
    // The whole server build equals the Quote's own composition for the same cart
    const w = makeWorld();
    const built = buildBooking(validateBookingInput(baseRequest({ items: [{ type: 'inflatable', unit_id: UNIT_A, wet_or_dry: 'dry', qty: 2 }] })).ok ? (validateBookingInput(baseRequest({ items: [{ type: 'inflatable', unit_id: UNIT_A, wet_or_dry: 'dry', qty: 2 }] })) as any).value : null, { pricingRulesRow: w.tables.pricing_rules[0], units: w.tables.units as any, products: w.tables.inventory_products as any, pricing: w.tables.product_pricing as any, categories: w.tables.product_categories as any, bundles: [] }, NOW);
    const expectedBd = clientCalculatePrice({ items: [{ unit_id: UNIT_A, wet_or_dry: 'dry', unit_price_cents: 20000, qty: 2 }], location_type: 'residential', surface: 'grass', can_use_stakes: true, overnight_allowed: true, num_days: 1, distance_miles: 5, city: 'Wayne', zip: '48184', has_generator: false, generator_qty: 0, rules, is_same_day_weekday_delivery: false } as any);
    ok('parity: a server-built order equals what the Quote computes (subtotal, tax, deposit, total)', built.ok && (built as any).plan.order.subtotal_cents === expectedBd.subtotal_cents && (built as any).plan.order.tax_cents === expectedBd.tax_cents && (built as any).plan.totals.depositCents === expectedBd.deposit_due_cents && (built as any).plan.totals.totalCents === expectedBd.total_cents);
  }

  // =============================================================================================================
  // 14. Remaining client-influenced value: the measured distance
  // =============================================================================================================
  {
    const w = makeWorld();
    const understated = await book(w, baseRequest({ event: { ...baseRequest().event, distance_miles: 0, address: { line1: '9 Far Rd', city: 'Toledo', state: 'OH', zip: '43604', lat: 41.65, lng: -83.54 } } }));
    ok('distance: a distance far below the straight-line distance from the shop is rejected', understated.status === 400 && w.db.orders.length === 0);
    const w2 = makeWorld();
    const honest = await book(w2, baseRequest({ event: { ...baseRequest().event, distance_miles: 50, address: { line1: '9 Far Rd', city: 'Toledo', state: 'OH', zip: '43604', lat: 41.65, lng: -83.54 } } }));
    ok('distance: a plausible driving distance is accepted and drives the travel fee', honest.status === 200 && w2.rpcCalls[0].p_payload.order.travel_fee_cents === 6000 && w2.rpcCalls[0].p_payload.order.travel_total_miles === 50);
    const w3 = makeWorld();
    const noCoords = await book(w3, baseRequest({ event: { ...baseRequest().event, address: { line1: '1 Main St', city: 'Wayne', state: 'MI', zip: '48184' } } }));
    ok('distance: an address without coordinates is rejected', noCoords.status === 400);
    const src = read('supabase/functions/_shared/booking/bookingBuild.ts');
    ok('distance: the build documents distance_miles as the only measured client number that feeds money', /distance_miles/.test(src) && /haversineMiles/.test(src));
  }

  // =============================================================================================================
  // 15. Consent and metadata
  // =============================================================================================================
  {
    const w = makeWorld();
    const none = await book(w, baseRequest({ consents: { sms: false, card_on_file: true } }));
    ok('consent: sms consent false is refused (the checkout requires it) and nothing is created', none.status === 400 && none.body.code === 'CONSENT_REQUIRED' && w.db.orders.length === 0);
    const none2 = await book(w, baseRequest({ consents: { sms: true, card_on_file: false } }));
    ok('consent: card-on-file consent false is refused and nothing is created', none2.status === 400 && w.db.orders.length === 0);
    const w2 = makeWorld();
    await book(w2, baseRequest());
    ok('consent: with both true the order stores real booleans and two consent rows', orderRow(w2).sms_consent === true && orderRow(w2).card_on_file_consent === true && w2.db.consent_records.length === 2);
    const sql = read('supabase/migrations/20261011120000_order_event_address_line2.sql');
    ok('consent: the RPC records consents as true only and takes ip / user agent from request_meta', /v_consent->>'consent_type', true, /.test(sql) && /v_meta->>'ip_address'/.test(sql) && /v_meta->>'user_agent'/.test(sql));
    const fn = read('supabase/functions/create-booking/index.ts');
    ok('consent: request metadata is derived on the server from the request headers', /getIdentifier\(req\)/.test(fn) && /req\.headers\.get\("user-agent"\)/.test(fn) && !/body\.(ip|meta|user_agent)/.test(fn));
  }

  // =============================================================================================================
  // 16. Wiring, rate limits, migration privileges
  // =============================================================================================================
  {
    const rl = read('supabase/functions/_shared/rate-limit.ts');
    for (const name of ['create-booking', 'check-availability', 'complete-booking']) {
      ok(`wiring: ${name} has a rate limit configuration`, new RegExp(`'${name}':\\s*\\{ maxRequests`).test(rl));
      const src = read(`supabase/functions/${name}/index.ts`);
      ok(`wiring: ${name} rate-limits by client IP and requires an identifier`, /checkRateLimit\(\s*"[a-z-]+",[\s\S]{0,120}true\s*\)/.test(src));
      ok(`wiring: ${name} is registered in supabase/config.toml (verify_jwt = false)`, new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt = false`).test(read('supabase/config.toml')));
    }
    const sql = read('supabase/migrations/20261011120000_order_event_address_line2.sql');
    const sqlOld = read('supabase/migrations/20261010120000_secure_public_booking_creation.sql');
    ok('migration: create_booking_request is revoked from PUBLIC, anon and authenticated and granted to service_role only', /REVOKE ALL ON FUNCTION public\.create_booking_request\(jsonb, text, timestamptz, uuid\) FROM PUBLIC/.test(sql) && /REVOKE ALL ON FUNCTION public\.create_booking_request\(jsonb, text, timestamptz, uuid\) FROM anon/.test(sql) && /REVOKE ALL ON FUNCTION public\.create_booking_request\(jsonb, text, timestamptz, uuid\) FROM authenticated/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.create_booking_request\(jsonb, text, timestamptz, uuid\) TO service_role/.test(sql) && !/GRANT EXECUTE ON FUNCTION public\.create_booking_request[^;]*(anon|authenticated|PUBLIC)/i.test(sql));
    ok('migration: the RPC is SECURITY DEFINER with a pinned search_path', /SECURITY DEFINER\s+SET search_path = public/.test(sql));
    ok('migration: the browser roles lose upsert_contact_from_checkout', /REVOKE ALL ON FUNCTION public\.upsert_contact_from_checkout\([^)]*\) FROM anon/.test(sqlOld) && /REVOKE ALL ON FUNCTION public\.upsert_contact_from_checkout\([^)]*\) FROM authenticated/.test(sqlOld) && /REVOKE ALL ON FUNCTION public\.upsert_contact_from_checkout\([^)]*\) FROM PUBLIC/.test(sqlOld));
    ok('migration: a guest cannot overwrite an authenticated customer profile', /IF v_customer_uid IS NULL OR v_customer_uid = p_caller_user_id THEN/.test(sql));
    ok('migration: the address upsert never re-points an existing owner or overwrites coordinates', /customer_id = COALESCE\(addresses\.customer_id, EXCLUDED\.customer_id\)/.test(sql) && /lat\s+= COALESCE\(addresses\.lat, EXCLUDED\.lat\)/.test(sql));
    ok('migration: no caller-supplied customer id or address id is read by the RPC', !/v_contact->>'customer_id'|v_address->>'id'|v_order->>'customer_id'|v_order->>'address_id'|p_payload->>'customer_id'/.test(sql));
  }

  // =============================================================================================================
  // 17. Browser side: public booking source scan, post-Stripe completion, legacy invoice route
  // =============================================================================================================
  {
    const CORE_TABLES = ['customers', 'addresses', 'orders', 'order_items', 'consent_records', 'payments', 'invoice_links', 'contacts'];
    const directAccess = (src: string) => CORE_TABLES.filter((t) => new RegExp(`\\.from\\(\\s*['"\`]${t}['"\`]`).test(src));
    const publicBookingFiles = ['src/pages/Checkout.tsx', 'src/lib/bookingApi.ts', 'src/hooks/usePaymentCompletion.ts', 'src/pages/PaymentComplete.tsx', 'src/components/payment/PaymentSuccessState.tsx', 'src/hooks/useCheckoutData.ts', 'src/pages/LegacyInvoiceRedirect.tsx', 'src/hooks/useQuoteCart.ts', 'src/pages/Catalog.tsx'];
    for (const f of publicBookingFiles) {
      const src = read(f);
      ok(`source scan: ${f} has no direct access to customers/addresses/orders/order_items/consent_records/payments/invoice_links/contacts`, directAccess(src).length === 0);
      ok(`source scan: ${f} does not call a database write (insert/update/upsert/delete)`, !(/supabase[\s\S]{0,60}\.(insert|update|upsert|delete)\(/.test(src)));
    }
    ok('source scan: nothing in src calls upsert_contact_from_checkout any more', !fs.readdirSync('src', { recursive: true }).filter((f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !/database\.types\.ts$/.test(f)).some((f: string) => /upsert_contact_from_checkout/.test(read(`src/${f}`))));
    ok('source scan: the Checkout page sends the booking through createBooking and never imports orderCreation', /createBooking\(/.test(read('src/pages/Checkout.tsx')) && !/orderCreation/.test(read('src/pages/Checkout.tsx')));
    ok('source scan: the Checkout page does not read pricing_rules or availability to SUBMIT (display totals only)', !/checkMultipleUnitsAvailability|createOrderBeforePayment/.test(read('src/pages/Checkout.tsx')));
    const req = read('src/lib/bookingApi.ts');
    const buildFn = req.slice(req.indexOf('export function buildBookingRequest'), req.indexOf('export interface CreatedBooking'));
    ok('source scan: the booking request builder sends no price, deposit, total, status, customer id or address id', !/unit_price_cents|deposit_due|deposit_cents|total_cents|subtotal|tax_cents|status|customer_id|address_id/.test(buildFn));
    ok('source scan: the booking card setup call sends the proof and order id, not money', /orderId: booking\.orderId,\s*bookingMode: true,\s*bookingToken: booking\.bookingToken/.test(req) && !/depositCents|tipCents|customerEmail/.test(req.slice(req.indexOf('export async function startBookingCardSetup'), req.indexOf('export interface CompletedBooking'))));

    // Post-Stripe completion goes through hardened server functions
    const hook = read('src/hooks/usePaymentCompletion.ts');
    ok('completion: the hook loads order details through complete-booking (Stripe-session proof)', /loadCompletedBooking\(/.test(hook) && !/fetchOrderDetails|supabase\./.test(hook));
    ok('completion: card save, lifecycle entry and the confirmation use server functions (the server owns the sent flag)', /save-payment-method-from-session/.test(hook) && /enterPendingReview/.test(hook) && hook.includes('sendCustomerBookingConfirmationNotifications(order, sessionId!)') && !/markBookingConfirmationSent/.test(hook));
    ok('completion: the hook requires a Stripe session id (a bare order id loads nothing)', /No payment session was provided/.test(hook));
    const cb = read('supabase/functions/complete-booking/index.ts');
    ok('completion: complete-booking accepts ONLY a completed Stripe session bound to the order', /accept:\s*\["stripe_session"\]/.test(cb) && /proveOrderAccess\(/.test(cb));
    const projection = cb.slice(cb.indexOf('const ORDER_PROJECTION'), cb.indexOf('async function retrieveCheckoutSession'));
    ok('completion: the order projection returns no Stripe, admin, token or payment-ledger fields', !/stripe_|admin_message|link_token|payment_method|signature|waiver|cancel|refund|custom_deposit|invoice_/.test(projection));
    ok('completion: the confirmation sent state is claimed, finalized and released only through the claim functions (no direct flag write, no browser-callable mark action)', /claim_booking_confirmation/.test(cb) && /finalize_booking_confirmation/.test(cb) && /release_booking_confirmation/.test(cb) && !/mark_confirmation_sent/.test(cb) && !/booking_confirmation_sent:\s*(true|false)/.test(cb));
    ok('completion: complete-booking never touches payments, status, deposit or Stripe charges', !/deposit_paid_cents|status:\s*["']|paymentIntents|from\("payments"\)/.test(cb.replace(/\.neq\("status", "draft"\)/, '')));

    // Legacy invoice route
    const app = read('src/App.tsx');
    ok('legacy invoice: /invoice/view/:orderId now renders the redirect, not the old page', /path="\/invoice\/view\/:orderId" element=\{<LegacyInvoiceRedirect \/>\}/.test(app) && !/pages\/Invoice'/.test(app));
    ok('legacy invoice: the old page, its checkout form and orderCreation are deleted', !fs.existsSync('src/pages/Invoice.tsx') && !fs.existsSync('src/components/payment/StripeCheckoutForm.tsx') && !fs.existsSync('src/lib/orderCreation.ts'));
    ok('legacy invoice: the redirect lands in the Customer Portal path (no UUID credential created)', /portalPathForCurrentVisitor\(orderId\)/.test(read('src/pages/LegacyInvoiceRedirect.tsx')));
    ok('legacy invoice: invoice_page_payment is no longer a customer confirmation source', !CUSTOMER_CONFIRM_SOURCES.includes('invoice_page_payment'));
    eq('legacy invoice: an invoice_page_payment confirmation is refused as an unknown source', evaluateCustomerConfirmation({ source: 'invoice_page_payment', order: { status: 'draft', deposit_due_cents: 0, deposit_paid_cents: 0 }, hasInvoiceContext: true } as any), { ok: false, reason: 'source_not_permitted' });
    const allSrc = fs.readdirSync('src', { recursive: true }).filter((f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f: string) => read(`src/${f}`)).join('\n') + fs.readdirSync('supabase/functions', { recursive: true }).filter((f: string) => /\.ts$/.test(f)).map((f: string) => read(`supabase/functions/${f}`)).join('\n');
    ok('legacy invoice: nothing generates a /invoice/view link', !/invoice\/view\//.test(allSrc.replace(/^\s*\/\/.*$/gm, '').replace(/path="\/invoice\/view\/:orderId"/, '')));
    ok('legacy invoice: invoice_page_payment has no callers anywhere', !/invoice_page_payment/.test(allSrc));
  }

  // =============================================================================================================
  // =============================================================================================================
  // 18. Delivery unit (address line 2) is order-specific
  // =============================================================================================================
  {
    const addr = (line2: string | null | undefined) => ({ line1: '123 Main St', ...(line2 === undefined ? {} : { line2 }), city: 'Wayne', state: 'MI', zip: '48184', lat: 42.3, lng: -83.4 });
    const req = (email: string, line2: string | null | undefined) => baseRequest({ contact: { first_name: 'A', last_name: 'B', email, phone: '5551234567' }, event: { ...baseRequest().event, address: addr(line2) } });
    const unitOf = (w: World, orderIndex: number) => {
      const o = w.db.orders[orderIndex];
      return eventAddressLine2({ ...o, addresses: w.db.addresses.find((a) => a.id === o.address_id) });
    };

    const w = makeWorld();
    const a = await book(w, req('a-unit@example.com', 'Apt 2A'));
    const b = await book(w, req('b-unit@example.com', 'Apt 8C'));
    ok('unit: both public bookings succeed', a.status === 200 && b.status === 200);
    ok('unit: the two orders share ONE canonical address row', w.db.addresses.length === 1 && w.db.orders[0].address_id === w.db.orders[1].address_id);
    eq('unit: each order stores its own unit', [w.db.orders[0].event_address_line2, w.db.orders[1].event_address_line2], ['Apt 2A', 'Apt 8C']);
    eq('unit: each order DISPLAYS its own unit (Apt 2A / Apt 8C)', [unitOf(w, 0), unitOf(w, 1)], ['Apt 2A', 'Apt 8C']);
    ok('unit: Order B did not inherit Order A\'s unit and Order A was not overwritten', unitOf(w, 1) !== 'Apt 2A' && unitOf(w, 0) !== 'Apt 8C');
    w.db.addresses[0].line2 = 'Suite 99'; // the canonical row is rewritten later
    eq('unit: rewriting the shared address row changes neither order', [unitOf(w, 0), unitOf(w, 1)], ['Apt 2A', 'Apt 8C']);

    const c = await book(w, req('c-unit@example.com', null));
    const d = await book(w, req('d-unit@example.com', undefined));
    const e = await book(w, req('e-unit@example.com', ''));
    const f = await book(w, req('f-unit@example.com', '   '));
    ok('unit: bookings with null / absent / empty / blank line2 succeed', [c, d, e, f].every((x) => x.status === 200));
    eq('unit: no unit is stored as an EMPTY string (never null / undefined / "null")', w.db.orders.slice(2).map((o) => o.event_address_line2), ['', '', '', '']);
    eq('unit: an order with no unit shows none and does NOT inherit the shared row\'s unit', [unitOf(w, 2), unitOf(w, 3), unitOf(w, 4), unitOf(w, 5)], ['', '', '', '']);
    ok('unit: the stored text is the trimmed entry', (await book(w, req('g-unit@example.com', '  Unit 7  '))).status === 200 && w.db.orders[6].event_address_line2 === 'Unit 7');
    eq('unit: "Apt 2A" is not rewritten to another spelling', (await book(w, req('h-unit@example.com', 'Apt 2A'))).status === 200 && w.db.orders[7].event_address_line2, 'Apt 2A');

    // Signed-in owner, existing guest record and brand-new guest all keep the unit
    const w2 = makeWorld();
    const owner = await book(w2, baseRequest({ contact: { first_name: 'Real', last_name: 'Owner', email: 'owner@example.com', phone: '5550000002' }, event: { ...baseRequest().event, address: addr('Apt 3C') } }), { callerUserId: 'u-owner' });
    const guestExisting = await book(w2, baseRequest({ contact: { first_name: 'Old', last_name: 'Guest', email: 'guest@example.com', phone: '5550000001' }, event: { ...baseRequest().event, address: addr('Apt 4D') } }));
    const guestNew = await book(w2, req('brand-new-unit@example.com', 'Apt 5E'));
    ok('unit: signed-in owner, existing guest and new guest all book', owner.status === 200 && guestExisting.status === 200 && guestNew.status === 200);
    eq('unit: signed-in owner preserves their unit', unitOf(w2, 0), 'Apt 3C');
    eq('unit: existing guest preserves their unit', unitOf(w2, 1), 'Apt 4D');
    eq('unit: new guest preserves their unit', unitOf(w2, 2), 'Apt 5E');
    eq('unit: three different units at one street stay distinct', [unitOf(w2, 0), unitOf(w2, 1), unitOf(w2, 2)], ['Apt 3C', 'Apt 4D', 'Apt 5E']);

    // The browser cannot choose the order column; only the event address line2 is read, by the server
    const smuggle = baseRequest();
    smuggle.event.event_address_line2 = 'Apt 666';
    const w3 = makeWorld();
    ok('unit: a client-sent event_address_line2 field is rejected by the allowlist', (await book(w3, smuggle)).status === 400 && w3.db.orders.length === 0);
    const w4 = makeWorld();
    await book(w4, req('payload-unit@example.com', ' Apt 2A '));
    ok('unit: the RPC payload carries the address line2; the order column is derived by the RPC, not sent', w4.rpcCalls[0].p_payload.address.line2 === 'Apt 2A' && !('event_address_line2' in w4.rpcCalls[0].p_payload.order));
    const unitSql = read('supabase/migrations/20261011120000_order_event_address_line2.sql');
    ok('unit (SQL): the RPC derives the order unit from the validated address, trimmed, empty when none', unitSql.includes("COALESCE(btrim(v_address->>'line2'), '')") && !/v_order->>'event_address_line2'/.test(unitSql));
  }

  console.log(`Public booking security tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} public booking security test(s) failed`);
})();

// ---------------------------------------------------------------------------------------------------------------
// Minimal fake clients
// ---------------------------------------------------------------------------------------------------------------
function fakeProofDb(rows: any[]): any {
  return {
    from: () => {
      const q: any = { filters: [] as any[], op: 'select', payload: null, returning: false };
      const match = () => rows.filter((r) => q.filters.every(([k, c, v]: any) => (k === 'eq' ? r[c] === v : k === 'is' ? (v === null ? r[c] == null : r[c] === v) : true)));
      const api: any = {
        select: () => ((q.returning = q.op === 'update'), api),
        eq: (c: string, v: unknown) => (q.filters.push(['eq', c, v]), api),
        is: (c: string, v: unknown) => (q.filters.push(['is', c, v]), api),
        update: (p: unknown) => ((q.op = 'update'), (q.payload = p), api),
        // Rows come back as COPIES, like a real database round trip (a live reference would hide races).
        // The read is a snapshot and the response arrives LATER (network latency), so concurrent requests all see the
        // pre-update state — exactly the race the atomic claim has to survive.
        maybeSingle: async () => {
          const snapshot = match()[0] ? { ...match()[0] } : null;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { data: snapshot, error: null };
        },
        then: (res: any, rej: any) => {
          let out: any;
          if (q.op === 'update') {
            const hit = match();
            hit.forEach((r) => Object.assign(r, q.payload));
            out = { data: q.returning ? hit.map((r) => ({ ...r })) : null, error: null };
          } else out = { data: match(), error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return api;
    },
  };
}
function fakeLinkClient(links: any[]): any {
  return {
    from: () => {
      const filters: any[] = [];
      const api: any = {
        select: () => api,
        eq: (c: string, v: unknown) => (filters.push([c, v]), api),
        in: (c: string, v: unknown[]) => (filters.push([c, v]), api),
        is: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: links.find((l) => filters.every(([c, v]) => (Array.isArray(v) ? v.includes(l[c]) : l[c] === v))) ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: links.filter((l) => filters.every(([c, v]) => (Array.isArray(v) ? v.includes(l[c]) : l[c] === v))), error: null }).then(res, rej),
      };
      return api;
    },
  };
}
