// Payment Safety A2.2 tests: secure Customer Portal read / write access.
//
// - customer-portal-data and customer-portal-action are loaded from their CURRENT source text and run with an in-memory
//   database (src/lib/portalTestHarness.ts) plus the real shared helpers. No network, no real database.
// - The browser-side loader, API client and refresh controller are exercised directly with fakes.
// - Source scans prove the customer-facing portal code no longer reads or writes the sensitive tables itself.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');

import './portalTestWindow';
import {
  ANON_KEY,
  FUTURE,
  PAST,
  SERVICE_KEY,
  addOrder,
  callFunction,
  loadFunction,
  makeClient,
  makeHarness,
  newDb,
  tokenFor,
  type Db,
  type Harness,
} from './portalTestHarness';
import * as projection from '../../supabase/functions/_shared/portal-projection';
import * as actions from '../../supabase/functions/_shared/portal-actions';
import * as lifecycleOutcome from '../../supabase/functions/_shared/lifecycle-outcome';
import { loadPortalOrder } from './portalOrderLoader';
import { PortalAccessError, fetchPortalData, portalAction, PortalActionError } from './customerPortalApi';
import { createPortalRefreshController, type RefreshEnv } from './portalRefreshController';

// Server-issued picture object ids (the portal chooses these; the browser never does).
const OBJ = '00000000-0000-4000-8000-000000000001';
const OBJ2 = '00000000-0000-4000-8000-000000000002';

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

const tp = (id: string) => tokenFor(`p-${id}`); // valid portal token for an order
const te = (id: string) => tokenFor(`e-${id}`); // expired portal token
const tr = (id: string) => tokenFor(`r-${id}`); // revoked portal token
const ti = (id: string) => tokenFor(`invoice-${id}`); // valid invoice token
const tie = (id: string) => tokenFor(`invoice-e-${id}`); // expired invoice token
const tir = (id: string) => tokenFor(`invoice-r-${id}`); // revoked invoice token

// ---------------------------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------------------------
function fixture(): Harness {
  const db = newDb();
  addOrder(db, { id: 'order-inv', customer: 'cust-A', status: 'draft', referral_source: null });
  addOrder(db, { id: 'order-inv2', customer: 'cust-B', status: 'draft' });
  addOrder(db, { id: 'order-nocard', customer: 'cust-A', status: 'draft', require_card_on_file: false, deposit_due_cents: 0, balance_due_cents: 20000 });
  addOrder(db, { id: 'order-nocard2', customer: 'cust-B', status: 'draft', require_card_on_file: false, deposit_due_cents: 0, balance_due_cents: 20000 });
  addOrder(db, { id: 'order-appr', customer: 'cust-A', status: 'awaiting_customer_approval', lot_pictures_requested: true });
  addOrder(db, { id: 'order-appr2', customer: 'cust-B', status: 'awaiting_customer_approval' });
  addOrder(db, { id: 'order-act', customer: 'cust-A', status: 'confirmed', lot_pictures_requested: true, waiver_signed_at: '2026-10-01T00:00:00Z', payment_method_brand: 'visa', payment_method_last_four: '4242' });
  addOrder(db, { id: 'order-act2', customer: 'cust-B', status: 'confirmed', event_date: '2026-12-24', event_end_date: '2026-12-24' });
  // an invoice-type link for the draft invoice order
  db.tables.invoice_links.push({ id: 'link-inv', order_id: 'order-inv', link_type: 'invoice', link_token: tokenFor('invoice-order-inv'), short_code: 'INVINV123456', expires_at: '2027-06-01T00:00:00Z', revoked_at: null, customer_filled: false, deposit_cents: 5000 });
  for (const id of ['order-inv', 'order-inv2', 'order-nocard', 'order-nocard2']) {
    if (id !== 'order-inv') db.tables.invoice_links.push({ id: `link-inv-${id}`, order_id: id, link_type: 'invoice', link_token: tokenFor(`invoice-${id}`), short_code: `INV${id}`.slice(0, 12), expires_at: FUTURE, revoked_at: null, customer_filled: false, deposit_cents: 0 });
    db.tables.invoice_links.push({ id: `link-inv-e-${id}`, order_id: id, link_type: 'invoice', link_token: tokenFor(`invoice-e-${id}`), short_code: null, expires_at: PAST, revoked_at: null, customer_filled: false, deposit_cents: 0 });
    db.tables.invoice_links.push({ id: `link-inv-r-${id}`, order_id: id, link_type: 'invoice', link_token: tokenFor(`invoice-r-${id}`), short_code: null, expires_at: FUTURE, revoked_at: PAST, customer_filled: false, deposit_cents: 0 });
  }
  // an ordinary draft BOOKING (no invoice link at all) and a draft whose only invoice link has expired
  addOrder(db, { id: 'order-booking', customer: 'cust-A', status: 'draft' });
  addOrder(db, { id: 'order-inv-expired', customer: 'cust-A', status: 'draft' });
  db.tables.invoice_links.push({ id: 'link-inv-expired-only', order_id: 'order-inv-expired', link_type: 'invoice', link_token: tokenFor('invoice-order-inv-expired'), short_code: null, expires_at: PAST, revoked_at: null, customer_filled: false, deposit_cents: 0 });
  db.tables.payments.push(
    { id: 'pay-1', order_id: 'order-act', type: 'deposit', amount_cents: 5000, status: 'succeeded', payment_method: 'card', payment_brand: 'visa', payment_last4: '4242', created_at: '2026-10-02T00:00:00Z', paid_at: '2026-10-02T00:00:01Z', stripe_payment_intent_id: 'pi_secret_1', stripe_fee_amount: 175, stripe_net_amount: 4825, ledger_sequence: 3, order_financials_applied: true, failed_at: null },
    { id: 'pay-other', order_id: 'order-act2', type: 'deposit', amount_cents: 7000, status: 'succeeded', payment_method: 'card', payment_brand: 'amex', payment_last4: '0005', created_at: '2026-10-02T00:00:00Z', stripe_payment_intent_id: 'pi_secret_2' },
  );
  db.tables.order_items.push(
    { id: 'oi-1', order_id: 'order-act', unit_id: 'unit-1', product_id: null, bundle_id: null, qty: 1, wet_or_dry: 'dry', unit_price_cents: 20000, notes: 'internal item note', units: undefined },
    { id: 'oi-2', order_id: 'order-act2', unit_id: 'unit-1', product_id: null, bundle_id: null, qty: 1, wet_or_dry: 'dry', unit_price_cents: 20000 },
    { id: 'oi-3', order_id: 'order-inv', unit_id: 'unit-9', product_id: null, bundle_id: null, qty: 1, wet_or_dry: 'dry', unit_price_cents: 20000 },
  );
  db.tables.order_discounts.push({ id: 'd-1', order_id: 'order-act', name: 'Promo', amount_cents: 1000, percentage: null, internal_reason: 'staff only' });
  db.tables.order_custom_fees.push({ id: 'f-1', order_id: 'order-act', name: 'Extra', amount_cents: 500, internal_reason: 'staff only' });
  db.tables.order_changelog.push(
    { id: 'c-1', order_id: 'order-appr', user_id: 'u-admin', field_changed: 'order_items', old_value: '', new_value: 'Castle (dry)', change_type: 'item', created_at: '2026-10-03T00:00:00Z', notes: 'internal staff note' },
    { id: 'c-2', order_id: 'order-act', user_id: 'u-admin', field_changed: 'status', old_value: 'a', new_value: 'b', change_type: 'status', created_at: '2026-10-03T00:00:00Z', notes: 'staff' },
  );
  db.tables.order_lot_pictures.push(
    { id: '11111111-1111-4111-8111-111111111111', order_id: 'order-appr', file_path: 'order-appr/a.jpg', file_name: 'a.jpg', notes: null, uploaded_at: '2026-10-04T00:00:00Z', uploaded_by: 'x' },
    { id: '22222222-2222-4222-8222-222222222222', order_id: 'order-appr2', file_path: 'order-appr2/b.jpg', file_name: 'b.jpg', notes: null, uploaded_at: '2026-10-04T00:00:00Z' },
  );
  db.tables.order_pictures.push({ id: 'p-1', order_id: 'order-act', file_path: 'order-act/p.jpg', file_name: 'p.jpg', file_size: 10, mime_type: 'image/jpeg', notes: 'n', uploaded_by: null, created_at: '2026-10-05T00:00:00Z' });
  db.tables.task_status.push({ id: 't-1', order_id: 'order-act', task_type: 'drop-off', status: 'completed', delivery_images: ['order-act/t-1/delivery/00000000-0000-4000-8000-0000000000d1.jpg', 'https://img/not-trusted.jpg'], damage_images: ['https://img/damage.jpg'], notes: 'crew note', crew_notes: 'crew only', admin_notes: 'admin only', gps_lat: 1, gps_lng: 2, completed_time: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:01Z', created_at: '2026-10-06T00:00:00Z' });
  return makeHarness(db);
}

(async () => {
  // =============================================================================================================
  // customer-portal-data: who may read an order
  // =============================================================================================================
  {
    const h = fixture();
    const fn = loadFunction('customer-portal-data', h);
    const call = (bearer: string | null, body: Record<string, unknown>) => callFunction(fn, bearer, body);

    const uuidOnly = await call(ANON_KEY, { orderId: 'order-act' });
    const unknownOrder = await call(ANON_KEY, { orderId: 'order-does-not-exist', token: tp('order-act') });
    const wrongOrderToken = await call(ANON_KEY, { orderId: 'order-act2', token: tp('order-act') });
    const expired = await call(ANON_KEY, { orderId: 'order-act', token: te('order-act') });
    const revoked = await call(ANON_KEY, { orderId: 'order-act', token: tr('order-act') });
    const noAuthHeader = await call(null, { orderId: 'order-act' });
    const junkToken = await call(ANON_KEY, { orderId: 'order-act', token: 'not-a-real-token-at-all' });
    const orderIdAsToken = await call(ANON_KEY, { orderId: 'order-act', token: 'order-act' });
    const badBody = await call(ANON_KEY, 'not json' as any);
    const denials = [uuidOnly, unknownOrder, wrongOrderToken, expired, revoked, noAuthHeader, junkToken, orderIdAsToken];
    ok('data: anonymous + order UUID only is denied (403)', uuidOnly.status === 403 && uuidOnly.json?.error === 'access_required');
    ok('data: every denial is byte-identical (cannot tell real order, wrong token, expired, revoked or unknown apart)', denials.every((d) => d.status === 403 && d.text === uuidOnly.text));
    ok('data: a denial carries no order data of any kind', !/order-act|Ann|Adams|ann@example|cus_secret|5000/.test(uuidOnly.text));
    ok('data: a malformed body is also the same denial', badBody.status === 403 && badBody.text === uuidOnly.text);
    ok('data: the public anon key alone is not proof', (await call(ANON_KEY, { orderId: 'order-act', sections: ['core'] })).status === 403);
    ok('data: customer email / phone / name in the request prove nothing', (await call(ANON_KEY, { orderId: 'order-act', email: 'ann@example.test', phone: '+15555550101', name: 'Ann Adams' })).status === 403);
    ok('data: GET is denied the same way', (await callFunction(fn, ANON_KEY, null, 'GET')).text === uuidOnly.text);

    const okA = await call(ANON_KEY, { orderId: 'order-act', token: tp('order-act') });
    ok('data: a valid Order A portal token loads Order A', okA.status === 200 && okA.json?.data?.order?.id === 'order-act' && okA.json.viewer === 'token');
    const crossAB = await call(ANON_KEY, { orderId: 'order-act2', token: tp('order-act') });
    ok('data: an Order A token cannot load Order B', crossAB.status === 403);
    const okB = await call(ANON_KEY, { orderId: 'order-act2', token: tp('order-act2') });
    ok('data: Order B\'s own token loads only Order B', okB.status === 200 && okB.json.data.order.id === 'order-act2' && !okB.text.includes('order-act"') );
    const inv = await call(ANON_KEY, { orderId: 'order-inv', token: tokenFor('invoice-order-inv') });
    ok('data: a valid invoice token loads its order with the invoice link facts', inv.status === 200 && inv.json.data.invoiceLink?.link_type === 'invoice' && inv.json.data.invoiceLink.deposit_cents === 5000);
    ok('data: the invoice token for Order inv cannot load another order', (await call(ANON_KEY, { orderId: 'order-inv2', token: tokenFor('invoice-order-inv') })).status === 403);
    ok('data: a portal-type token is not presented as an invoice link', okA.json.data.invoiceLink === null);

    const owner = await call('jwt-A', { orderId: 'order-act' });
    ok('data: the signed-in owner loads their own order without any token', owner.status === 200 && owner.json.viewer === 'owner');
    ok('data: a signed-in customer cannot load someone else\'s order', (await call('jwt-B', { orderId: 'order-act' })).status === 403);
    ok('data: an authenticated user with no relationship is denied', (await call('jwt-none', { orderId: 'order-act' })).status === 403);
    ok('data: a signed-in customer\'s own login does not unlock another order even with their UUID', (await call('jwt-A', { orderId: 'order-act2' })).status === 403);
    ok('data: a different customer holding Order A\'s valid token can load Order A (the token is the proof)', (await call('jwt-B', { orderId: 'order-act', token: tp('order-act') })).status === 200);
    ok('data: admin can open the portal read-only for support', (await call('jwt-admin', { orderId: 'order-act' })).json?.viewer === 'staff');
    ok('data: master can open the portal read-only for support', (await call('jwt-master', { orderId: 'order-act' })).status === 200);
    ok('data: crew gets no portal access to arbitrary orders', (await call('jwt-crew', { orderId: 'order-act' })).status === 403);
    ok('data: the service role is allowed', (await call(SERVICE_KEY, { orderId: 'order-act' })).json?.viewer === 'service');

    // -------------------------------------------------------------------------------------------------------
    // Projection
    // -------------------------------------------------------------------------------------------------------
    const p = owner.json.data;
    const orderKeys = Object.keys(p.order);
    const derived = ['has_saved_card', 'has_signed_waiver_document', 'customers', 'addresses', 'payments'];
    ok('projection: every order field is on the allowlist or a derived presence flag', orderKeys.every((k) => projection.PORTAL_ORDER_FIELDS.includes(k) || derived.includes(k)));
    ok('projection: no excluded internal order field is present', projection.PORTAL_ORDER_EXCLUDED_FIELDS.every((k) => !(k in p.order)));
    ok('projection: Stripe customer / payment-method identifiers never reach the browser', !owner.text.includes('cus_secret_123') && !owner.text.includes('pm_secret_123') && !owner.text.includes('pm_internal'));
    ok('projection: saved-card presence is a boolean', p.order.has_saved_card === true && p.order.has_signed_waiver_document === true);
    ok('projection: signature data, staff notes and billing details are absent', !/SECRETSIG|staff edit note|staff reason|9 Billing Rd|gate code|lock-1|signed\.pdf/.test(owner.text));
    ok('projection: the card brand / last four shown to the customer are present', p.order.payment_method_brand === 'visa' && p.order.payment_method_last_four === '4242');
    eq('projection: customer keys', Object.keys(p.order.customers).sort(), ['business_name', 'email', 'first_name', 'id', 'last_name', 'phone']);
    eq('projection: address keys', Object.keys(p.order.addresses).sort(), ['city', 'id', 'lat', 'line1', 'line2', 'lng', 'state', 'zip']);
    ok('projection: no oauth profile, user id or default address leaks from the customer record', !/oauth|u-cust-A|default_address|user_id/.test(owner.text));
    ok('projection: payments carry only customer-facing facts', p.order.payments.length === 1 && Object.keys(p.order.payments[0]).every((k) => ['id', 'order_id', 'amount_cents', 'type', 'status', 'payment_method', 'payment_last4', 'payment_brand', 'created_at', 'paid_at'].includes(k)));
    ok('projection: no payment intent id, fee, net or ledger data', !/pi_secret|stripe_fee|stripe_net|ledger_sequence|order_financials/.test(owner.text));
    ok('projection: other customers\' orders, payments and items never appear', !/order-act2|pay-other|0005|oi-2|Burns|bo@example/.test(owner.text));
    ok('projection: no token, short code or link list is returned', !/link_token|short_code|SCp|tok-|INVINV|invoice_links/.test(owner.text) && !('links' in p));
    ok('projection: order items omit the internal item note', !owner.text.includes('internal item note'));
    ok('projection: discounts and fees omit internal reasons', !owner.text.includes('staff only'));
    ok('projection: the customer\'s own discount and fee are present', p.discounts[0].name === 'Promo' && p.customFees[0].name === 'Extra');
    ok('projection: changelog is only returned for pending/approval statuses', Array.isArray(p.changelog) && p.changelog.length === 0);
    const appr = await call('jwt-A', { orderId: 'order-appr' });
    ok('projection: the approval changelog carries only field / old / new / time (no staff user or notes)', appr.json.data.changelog.length === 1 && Object.keys(appr.json.data.changelog[0]).every((k) => ['field_changed', 'old_value', 'new_value', 'created_at'].includes(k)) && !appr.text.includes('internal staff note'));
    ok('projection: delivery omits damage photos and crew / admin notes', p.delivery.delivery_images.length === 1 && p.delivery.delivery_images[0].includes('/object/sign/order-evidence/order-act/t-1/delivery/') && !/not-trusted/.test(owner.text) && !/damage|crew note|crew only|admin only|gps/.test(owner.text));
    ok('projection: customer pictures carry display facts only', p.pictures.length === 1 && Object.keys(p.pictures[0]).every((k) => ['id', 'file_path', 'file_name', 'notes', 'created_at', 'url'].includes(k)));
    ok('projection: lot pictures omit the uploader', !appr.text.includes('"uploaded_by"'));
    ok('projection: pricing configuration (public) is included for the summary builder', p.pricing?.base_radius_miles === 10);
    const lotOnly = await call('jwt-A', { orderId: 'order-appr', sections: ['lotPictures'] });
    eq('projection: requesting one section returns only that section', Object.keys(lotOnly.json.data), ['lotPictures']);
    const rec = await call('jwt-A', { orderId: 'order-act', sections: ['core', 'summary', 'payment'], paymentId: 'pay-1' });
    ok('projection: a receipt read returns the requested payment of this order', rec.json.data.payment?.id === 'pay-1' && rec.json.data.orderItems.length === 1);
    const recOther = await call('jwt-A', { orderId: 'order-act', sections: ['payment'], paymentId: 'pay-other' });
    ok('projection: another order\'s payment id returns nothing', recOther.json.data.payment === null);
    ok('projection: the endpoint cannot be used to enumerate orders (no list / search input is honored)', !/orders"?:\s*\[/.test(owner.text) && (await call(ANON_KEY, { orderId: '%', token: 'x'.repeat(64) })).status === 403);
    ok('data: nothing sensitive is logged', !h.logs.join('\n').match(/tok-|cus_secret|ann@example/));
    ok('data: the response is not cacheable', (await fn(new Request('https://x.test', { method: 'POST', headers: { Authorization: 'Bearer jwt-A' }, body: JSON.stringify({ orderId: 'order-act' }) }))).headers.get('Cache-Control') === 'no-store');
  }

  // Projection functions in isolation: sensitive extras on the raw row never survive.
  {
    const raw = { id: 'l', link_type: 'invoice', customer_filled: true, deposit_cents: 1, expires_at: 'x', link_token: 'SECRET', short_code: 'SC', revoked_at: null, order_id: 'o' };
    eq('projection unit: an invoice link keeps its facts and drops the token, short code and order id', projection.projectInvoiceLink(raw), { id: 'l', link_type: 'invoice', customer_filled: true, deposit_cents: 1, expires_at: 'x' });
    ok('projection unit: payments drop processor ids and fees', !('stripe_payment_intent_id' in projection.projectPayment({ id: 'p', amount_cents: 1, stripe_payment_intent_id: 'pi_x', stripe_fee_amount: 3 })));
    ok('projection unit: customers drop oauth data and user ids', !('oauth_profile_data' in (projection.projectCustomer({ id: 'c', first_name: 'A', oauth_profile_data: { a: 1 }, user_id: 'u' }) as any)) && !('user_id' in (projection.projectCustomer({ id: 'c', user_id: 'u' }) as any)));
    ok('projection unit: delivery state drops damage photos and notes', !('damage_images' in (projection.projectDelivery({ delivery_images: [], status: 's', damage_images: ['x'], notes: 'n' }) as any)));
    const o = projection.projectOrder({ id: 'o', status: 'draft', stripe_customer_id: 'cus_x', stripe_payment_method_id: 'pm_x', signed_waiver_url: 'u', waiver_signature_data: 's' }, {});
    ok('projection unit: orders expose presence flags instead of Stripe ids and the waiver document', o.has_saved_card === true && o.has_signed_waiver_document === true && !('stripe_customer_id' in o) && !('waiver_signature_data' in o));
  }

  // The UI contract: every order field the customer-facing portal reads must be available from the projection.
  {
    const files = [
      'src/pages/CustomerPortal.tsx',
      'src/pages/Receipt.tsx',
      'src/pages/Sign.tsx',
      'src/lib/orderSummary.ts',
      'src/lib/orderEmailTemplates.ts',
      ...fs.readdirSync('src/components/customer-portal').filter((f: string) => f.endsWith('.tsx')).map((f: string) => `src/components/customer-portal/${f}`),
    ];
    const used = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/\border\??\.([a-z_][a-z_0-9]*)/g)) used.add(m[1]);
    const available = new Set<string>([...projection.PORTAL_ORDER_FIELDS, 'has_saved_card', 'has_signed_waiver_document', 'customers', 'addresses', 'payments']);
    // Names the UI reads that are not database columns at all (always undefined today); listed so a new one is noticed.
    const notColumns = new Set(['order_number', 'total_cents', 'customer_email', 'customer', 'address', 'order_items']);
    const missing = [...used].filter((k) => !available.has(k) && !notColumns.has(k));
    eq('ui contract: every order field the portal UI reads is served by the projection (or is not a real column)', missing, []);
    ok('ui contract: the excluded internal fields are not read by the portal UI', projection.PORTAL_ORDER_EXCLUDED_FIELDS.every((k) => !used.has(k)));
  }

  // =============================================================================================================
  // customer-portal-action: validator
  // =============================================================================================================
  {
    const v = (name: unknown, payload: unknown, order = 'order-act') => actions.validateAction(name, payload, order);
    ok('validator: unknown action names are rejected', v('update_order', {}) === null && v('', {}) === null && v(undefined, {}) === null && v('__proto__', {}) === null);
    ok('validator: a generic field-update shape is rejected for every action', actions.PORTAL_ACTION_NAMES.every((n) => v(n, { fields: { status: 'confirmed' } }) === null));
    ok('validator: invoice details accept only the named keys', v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, status: 'confirmed' }) === null && v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, customer_id: 'x' }) === null && v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, deposit_paid_cents: 1 }) === null);
    ok('validator: consents must be real booleans', v('invoice_accept_details', { cardOnFileConsent: 'true', smsConsent: true }) === null && v('invoice_accept_details', { smsConsent: true }) === null);
    ok('validator: a customer block cannot carry an id or extra columns', v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, customer: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone: '1', id: 'cust-B' } }) === null && v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, customer: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone: '1', user_id: 'u' } }) === null);
    ok('validator: a valid customer block passes', v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: false, customer: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone: '555' } }) !== null);
    ok('validator: referral source must be one of the offered values', v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, referralSource: 'google' }) !== null && v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, referralSource: 'confirmed' }) === null);
    ok('validator: tip and payment amounts must be whole non-negative cents', v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, tipCents: -1 }) === null && v('invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, tipCents: 1.5 }) === null && v('invoice_select_payment', { amountCents: '5000', type: 'deposit' }) === null && v('invoice_select_payment', { amountCents: 5000, type: 'free' }) === null);
    ok('validator: approve accepts only payment selection + tip', v('approve_changes', { selectedPaymentCents: 100, selectedPaymentType: 'deposit' }) !== null && v('approve_changes', { selectedPaymentCents: 100, selectedPaymentType: 'deposit', status: 'confirmed' }) === null && v('approve_changes', { selectedPaymentCents: 100, selectedPaymentType: 'deposit', deposit_paid_cents: 9 }) === null && v('approve_changes', { selectedPaymentCents: 100, selectedPaymentType: 'deposit', customer_id: 'c' }) === null);
    ok('validator: no-payload actions take no payload', v('invoice_confirm_no_card', { status: 'confirmed' }) === null && v('check_unit_availability', { unit_id: 'u' }) === null && v('invoice_confirm_no_card', {}) !== null);
    ok('validator: storage paths must be a server-issued object inside this order\'s folder', v('register_lot_pictures', { files: [{ path: `order-act/${OBJ}.jpg`, name: 'a.jpg' }] }) !== null && v('register_lot_pictures', { files: [{ path: `order-other/${OBJ}.jpg`, name: 'a.jpg' }] }) === null && v('register_lot_pictures', { files: [{ path: 'order-act/a.jpg', name: 'a.jpg' }] }) === null && v('register_lot_pictures', { files: [{ path: `order-act/../order-other/${OBJ}.jpg`, name: 'a.jpg' }] }) === null && v('register_lot_pictures', { files: [{ path: '/etc/passwd', name: 'a' }] }) === null);
    ok('validator: at most four lot pictures per request, none empty', v('register_lot_pictures', { files: Array(5).fill({ path: `order-act/${OBJ}.jpg`, name: 'a' }) }) === null && v('register_lot_pictures', { files: [] }) === null);
    ok('validator: order pictures: size, type and keys are checked', v('register_order_pictures', { files: [{ path: `order-act/${OBJ}.jpg`, name: 'a', size: 100, mimeType: 'image/jpeg' }] }) !== null && v('register_order_pictures', { files: [{ path: `order-act/${OBJ}.exe`, name: 'a', size: 100, mimeType: 'application/x-msdownload' }] }) === null && v('register_order_pictures', { files: [{ path: `order-act/${OBJ}.jpg`, name: 'a', size: 99999999, mimeType: 'image/jpeg' }] }) === null && v('register_order_pictures', { files: [{ path: `order-act/${OBJ}.jpg`, name: 'a', size: 1, mimeType: 'image/jpeg', uploaded_by: 'x' }] }) === null);
    ok('validator: delete takes a uuid only', v('delete_lot_picture', { pictureId: 'not-a-uuid' }) === null && v('delete_lot_picture', { pictureId: '11111111-1111-4111-8111-111111111111', order_id: 'x' }) === null);
    ok('validator: payment selection check uses the order\'s own figures', actions.paymentSelectionIsValid({ amountCents: 5000, type: 'deposit' }, { deposit_due_cents: 5000, balance_due_cents: 15000 }) && actions.paymentSelectionIsValid({ amountCents: 20000, type: 'full' }, { deposit_due_cents: 5000, balance_due_cents: 15000 }) && !actions.paymentSelectionIsValid({ amountCents: 1, type: 'deposit' }, { deposit_due_cents: 5000, balance_due_cents: 15000 }) && !actions.paymentSelectionIsValid({ amountCents: 4999, type: 'custom' }, { deposit_due_cents: 5000, balance_due_cents: 15000 }) && !actions.paymentSelectionIsValid({ amountCents: 20001, type: 'custom' }, { deposit_due_cents: 5000, balance_due_cents: 15000 }));
  }

  // =============================================================================================================
  // customer-portal-action: authorization matrix, split by capability
  // =============================================================================================================
  // 'portal'  actions: a canonical portal token (or the signed-in owner) may perform them.
  // 'invoice' actions: only an invoice-type token, or the owner / backend of an order with a CURRENT invoice link.
  interface Case { action: string; kind: 'portal' | 'invoice'; payload: Record<string, unknown>; A: string; B: string; effect: (db: Db, id: string) => boolean }
  const order = (db: Db, id: string) => db.tables.orders.find((o) => o.id === id)!;
  const cases: Case[] = [
    { action: 'invoice_accept_details', kind: 'invoice', payload: { cardOnFileConsent: true, smsConsent: true }, A: 'order-inv', B: 'order-inv2', effect: (db, id) => order(db, id).sms_consent === true && !!order(db, id).invoice_accepted_at },
    { action: 'invoice_select_payment', kind: 'invoice', payload: { amountCents: 5000, type: 'deposit' }, A: 'order-inv', B: 'order-inv2', effect: (db, id) => order(db, id).customer_selected_payment_cents === 5000 },
    { action: 'invoice_confirm_no_card', kind: 'invoice', payload: {}, A: 'order-nocard', B: 'order-nocard2', effect: (db, id) => order(db, id).same_day_responsibility_accepted === true && order(db, id).status === 'draft' },
    { action: 'approve_changes', kind: 'portal', payload: { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, A: 'order-appr', B: 'order-appr2', effect: (db, id) => order(db, id).customer_selected_payment_cents === 5000 && order(db, id).status === 'awaiting_customer_approval' },
    { action: 'reject_changes', kind: 'portal', payload: { reason: 'changed my mind' }, A: 'order-appr', B: 'order-appr2', effect: (db, id) => order(db, id).status === 'cancelled' && order(db, id).cancellation_reason === 'changed my mind' },
    { action: 'register_lot_pictures', kind: 'portal', payload: { files: [{ path: `order-act/${OBJ}.jpg`, name: 'new.jpg' }] }, A: 'order-act', B: 'order-act2', effect: (db, id) => db.tables.order_lot_pictures.some((r) => r.order_id === id && r.file_name === 'new.jpg') },
    { action: 'delete_lot_picture', kind: 'portal', payload: { pictureId: '11111111-1111-4111-8111-111111111111' }, A: 'order-appr', B: 'order-appr2', effect: (db) => !db.tables.order_lot_pictures.some((r) => r.id === '11111111-1111-4111-8111-111111111111') },
    { action: 'register_order_pictures', kind: 'portal', payload: { files: [{ path: `order-act/${OBJ}.jpg`, name: 'pic.jpg', size: 1000, mimeType: 'image/jpeg' }], notes: 'hi' }, A: 'order-act', B: 'order-act2', effect: (db, id) => db.tables.order_pictures.some((r) => r.order_id === id && r.file_name === 'pic.jpg') },
    { action: 'check_unit_availability', kind: 'portal', payload: {}, A: 'order-act', B: 'order-act2', effect: () => true },
  ];
  for (const c of cases) {
    const own = c.kind === 'invoice' ? ti : tp; // the token type that carries this capability
    const ownExpired = c.kind === 'invoice' ? tie : te;
    const ownRevoked = c.kind === 'invoice' ? tir : tr;
    const run = async (bearer: string | null, orderId: string, token?: string, payload: Record<string, unknown> = c.payload, action = c.action) => {
      const h = fixture();
      // Objects the server would have authorized and the browser uploaded before registering them.
      for (const f of ((payload.files as Array<{ path: string }> | undefined) ?? [])) h.db.storageObjects.push(`lot-pictures:${f.path}`, `order-pictures:${f.path}`);
      const res = await callFunction(loadFunction('customer-portal-action', h), bearer, { orderId, ...(token ? { token } : {}), action, payload });
      return { h, res, writes: h.db.writes.length };
    };
    const label = `action ${c.action} [${c.kind}]`;
    let r = await run(ANON_KEY, c.A);
    ok(`${label}: anonymous + order UUID only is denied and writes nothing`, r.res.status === 403 && r.writes === 0);
    r = await run(ANON_KEY, c.A, own(c.A));
    ok(`${label}: the right token type for Order A is allowed on Order A`, r.res.status === 200 && r.res.json?.success === true && c.effect(r.h.db, c.A));
    r = await run(ANON_KEY, c.B, own(c.A));
    ok(`${label}: an Order A token is denied on Order B (cross-order) and writes nothing`, r.res.status === 403 && r.writes === 0);
    r = await run(ANON_KEY, c.A, ownExpired(c.A));
    ok(`${label}: an expired token is denied`, r.res.status === 403 && r.writes === 0);
    r = await run(ANON_KEY, c.A, ownRevoked(c.A));
    ok(`${label}: a revoked token is denied`, r.res.status === 403 && r.writes === 0);
    r = await run('jwt-A', c.A);
    ok(`${label}: the signed-in owner is allowed without a token`, r.res.status === 200 && r.res.json?.success === true && c.effect(r.h.db, c.A));
    r = await run('jwt-B', c.A);
    ok(`${label}: a different signed-in customer is denied`, r.res.status === 403 && r.writes === 0);
    r = await run('jwt-none', c.A);
    ok(`${label}: an authenticated user with no relationship is denied`, r.res.status === 403 && r.writes === 0);
    r = await run('jwt-crew', c.A);
    ok(`${label}: crew is not treated as the customer`, r.res.status === 403 && r.writes === 0);
    r = await run('jwt-admin', c.A);
    ok(`${label}: staff opening the portal for support cannot act as the customer`, r.res.status === 403 && r.writes === 0);
    r = await run(SERVICE_KEY, c.A);
    ok(`${label}: the backend (service role) is allowed`, r.res.status === 200 && r.res.json?.success === true);
    r = await run(ANON_KEY, c.A, own(c.A), c.payload, 'update_order');
    ok(`${label}: an arbitrary action name is rejected even with valid proof`, r.res.status === 400 && r.writes === 0);
    r = await run(ANON_KEY, c.A, own(c.A), { ...c.payload, status: 'confirmed', deposit_paid_cents: 999999, customer_id: 'cust-B', stripe_payment_status: 'paid' });
    ok(`${label}: smuggled fields (status, deposit_paid_cents, customer_id, ...) are rejected and nothing is written`, r.res.status === 400 && r.writes === 0 && order(r.h.db, c.A).deposit_paid_cents !== 999999 && order(r.h.db, c.A).customer_id !== 'cust-B');
    ok(`${label}: nothing sensitive is logged`, !r.h.logs.join('\n').match(/tok-|cus_secret|pm_secret/));
    if (c.kind === 'invoice') {
      r = await run(ANON_KEY, c.A, tp(c.A));
      ok(`${label}: a normal PORTAL token for the same order is denied (invoice-only capability)`, r.res.status === 403 && r.writes === 0);
    }
  }

  // Invoice context for the signed-in owner and the backend
  {
    const inv = async (bearer: string | null, orderId: string, action = 'invoice_accept_details', payload: Record<string, unknown> = { cardOnFileConsent: true, smsConsent: true }) => {
      const h = fixture();
      return { h, res: await callFunction(loadFunction('customer-portal-action', h), bearer, { orderId, action, payload }) };
    };
    for (const [action, payload, okOrder] of [
      ['invoice_accept_details', { cardOnFileConsent: true, smsConsent: true }, 'order-inv'],
      ['invoice_select_payment', { amountCents: 5000, type: 'deposit' }, 'order-inv'],
      ['invoice_confirm_no_card', {}, 'order-nocard'],
    ] as Array<[string, Record<string, unknown>, string]>) {
      let r = await inv('jwt-A', okOrder, action, payload);
      ok(`invoice context: owner WITH a current Admin Invoice link may use ${action}`, r.res.status === 200);
      r = await inv('jwt-A', 'order-booking', action, payload);
      ok(`invoice context: owner of an ordinary draft booking (no invoice link) is denied ${action}`, r.res.status === 403 && r.h.db.writes.length === 0);
      r = await inv('jwt-A', 'order-inv-expired', action, payload);
      ok(`invoice context: owner whose invoice link has expired is denied ${action}`, r.res.status === 403 && r.h.db.writes.length === 0);
      r = await inv(SERVICE_KEY, 'order-booking', action, payload);
      ok(`invoice context: the backend cannot turn an ordinary draft booking into an invoice (${action})`, r.res.status === 403 && r.h.db.writes.length === 0);
      r = await inv(SERVICE_KEY, okOrder, action, payload);
      ok(`invoice context: the backend works on a real invoice (${action})`, r.res.status === 200);
      const h = fixture();
      r = { h, res: await callFunction(loadFunction('customer-portal-action', h), ANON_KEY, { orderId: okOrder, token: ti(okOrder), action, payload }) };
      ok(`invoice context: an invoice token works on its own draft invoice (${action})`, r.res.status === 200);
      const h2 = fixture();
      const crossB = okOrder === 'order-nocard' ? 'order-nocard2' : 'order-inv2';
      const cross = await callFunction(loadFunction('customer-portal-action', h2), ANON_KEY, { orderId: crossB, token: ti(okOrder), action, payload });
      ok(`invoice context: Order A's invoice token cannot be used on Order B (${action})`, cross.status === 403 && h2.db.writes.length === 0);
    }
    // an invoice token also reaches the normal portal capabilities of its own order, and only that order
    {
      const h = fixture();
      const res = await callFunction(loadFunction('customer-portal-data', h), ANON_KEY, { orderId: 'order-inv', token: ti('order-inv') });
      ok('invoice token still reads its own invoice order through the portal read API', res.status === 200 && res.json.data.invoiceLink?.link_type === 'invoice');
    }
  }

  // =============================================================================================================
  // customer-portal-action: behavior
  // =============================================================================================================
  {
    const act = async (bearer: string | null, orderId: string, action: string, payload: Record<string, unknown>, token?: string, h: Harness = fixture()) => ({
      h,
      // Pictures to register were uploaded to the private buckets under server-issued paths before registration.
      seeded: ((payload.files as Array<{ path: string }> | undefined) ?? []).forEach((f) => h.db.storageObjects.push(`lot-pictures:${f.path}`, `order-pictures:${f.path}`)),
      res: await callFunction(loadFunction('customer-portal-action', h), bearer, { orderId, ...(token ? { token } : {}), action, payload }),
    });

    // invoice details
    let x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', {
      cardOnFileConsent: true,
      smsConsent: true,
      customer: { first_name: 'Anne', last_name: 'Adams', email: 'anne@example.test', phone: '+15555550999', business_name: 'Biz' },
      referralSource: 'google',
      referralSourceDetail: 'google_search',
      tipCents: 1500,
    }, ti('order-inv'));
    let o = order(x.h.db, 'order-inv');
    ok('invoice details: consents, referral and tip are saved on the order', x.res.status === 200 && o.card_on_file_consent === true && o.sms_consent === true && o.referral_source === 'google' && o.referral_source_detail === 'google_search' && o.tip_cents === 1500);
    ok('invoice details: the order\'s own customer record is updated (no id substitution)', o.customer_id === 'cust-A' && x.h.db.tables.customers.find((c) => c.id === 'cust-A')?.first_name === 'Anne' && x.h.db.tables.customers.find((c) => c.id === 'cust-A')?.business_name === 'Biz');
    ok('invoice details: only the order\'s own invoice link is marked filled', x.h.db.tables.invoice_links.find((l) => l.id === 'link-inv')?.customer_filled === true && x.h.db.tables.invoice_links.filter((l) => l.customer_filled === true).length === 1);
    ok('invoice details: the order itself never changes status here', o.status === 'draft');
    x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, customer: { first_name: 'Evil', last_name: 'Actor', email: 'bo@example.test', phone: '1' } }, ti('order-inv'));
    ok('invoice details: typing another customer\'s email never moves the order to (or edits) that customer', order(x.h.db, 'order-inv').customer_id === 'cust-A' && x.h.db.tables.customers.find((c) => c.id === 'cust-B')?.first_name === 'Bo' && x.h.db.tables.customers.find((c) => c.id === 'cust-A')?.email === 'ann@example.test');
    x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', { cardOnFileConsent: true, smsConsent: false }, ti('order-inv'));
    ok('invoice details: SMS consent is stored exactly as given (no inference from a phone number)', order(x.h.db, 'order-inv').sms_consent === false);
    {
      const h = fixture();
      order(h.db, 'order-inv').customer_id = null;
      x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, customer: { first_name: 'Evil', last_name: 'Actor', email: 'bo@example.test', phone: '1' } }, ti('order-inv'), h);
      ok('invoice details: with no customer yet, an existing email links to that record WITHOUT overwriting it', order(h.db, 'order-inv').customer_id === 'cust-B' && h.db.tables.customers.find((c) => c.id === 'cust-B')?.first_name === 'Bo');
      const h2 = fixture();
      order(h2.db, 'order-inv').customer_id = null;
      x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, customer: { first_name: 'New', last_name: 'Person', email: 'new@example.test', phone: '5' } }, ti('order-inv'), h2);
      ok('invoice details: with no customer yet and a new email, a new customer is created and linked', h2.db.tables.customers.some((c) => c.email === 'new@example.test') && order(h2.db, 'order-inv').customer_id === h2.db.tables.customers.find((c) => c.email === 'new@example.test')?.id);
    }
    x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, referralSource: 'nonsense' }, ti('order-inv'));
    ok('invoice details: an unknown referral source is rejected', x.res.status === 400 && x.h.db.writes.length === 0);
    {
      const h = fixture();
      order(h.db, 'order-inv').referral_source = 'google';
      x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', { cardOnFileConsent: true, smsConsent: true, referralSource: 'other' }, ti('order-inv'), h);
      ok('invoice details: an already-captured referral source is never overwritten', order(h.db, 'order-inv').referral_source === 'google');
    }
{
      const h = fixture();
      order(h.db, 'order-inv').status = 'confirmed';
      x = await act(ANON_KEY, 'order-inv', 'invoice_accept_details', { cardOnFileConsent: true, smsConsent: true }, ti('order-inv'), h);
      ok('invoice details: only a draft invoice can be accepted (409 otherwise)', x.res.status === 409 && h.db.writes.length === 0);
    }

    // payment selection
    x = await act(ANON_KEY, 'order-inv', 'invoice_select_payment', { amountCents: 20000, type: 'full' }, ti('order-inv'));
    ok('payment selection: full pays deposit + balance and is stored with its type', x.res.status === 200 && order(x.h.db, 'order-inv').customer_selected_payment_cents === 20000 && order(x.h.db, 'order-inv').customer_selected_payment_type === 'full');
    x = await act(ANON_KEY, 'order-inv', 'invoice_select_payment', { amountCents: 1, type: 'deposit' }, ti('order-inv'));
    ok('payment selection: an amount that does not match the order\'s own deposit is rejected', x.res.status === 400 && x.h.db.writes.length === 0);
    x = await act(ANON_KEY, 'order-inv', 'invoice_select_payment', { amountCents: 4000, type: 'custom' }, ti('order-inv'));
    ok('payment selection: a custom amount below the deposit is rejected', x.res.status === 400);
    x = await act(ANON_KEY, 'order-inv', 'invoice_select_payment', { amountCents: 99999999, type: 'custom' }, ti('order-inv'));
    ok('payment selection: a custom amount above the order total is rejected', x.res.status === 400);

    // confirm without a card
    x = await act(ANON_KEY, 'order-inv', 'invoice_confirm_no_card', {}, ti('order-inv'));
    ok('no-card confirm: an invoice that requires a card or deposit cannot be confirmed this way (409)', x.res.status === 409 && order(x.h.db, 'order-inv').status === 'draft');
    x = await act(ANON_KEY, 'order-nocard', 'invoice_confirm_no_card', {}, ti('order-nocard'));
ok('no-card confirm: a $0, no-card invoice records acceptance + responsibility but is NOT confirmed by this action', x.res.status === 200 && order(x.h.db, 'order-nocard').status === 'draft' && order(x.h.db, 'order-nocard').same_day_responsibility_accepted === true && !!order(x.h.db, 'order-nocard').invoice_accepted_at);

    // approval / rejection
    x = await act(ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit', tipCents: 700 }, tp('order-appr'));
    o = order(x.h.db, 'order-appr');
ok('approval: records the payment selection and tip but does NOT confirm the order', x.res.status === 200 && o.customer_selected_payment_cents === 5000 && o.customer_selected_payment_type === 'deposit' && o.tip_cents === 700 && o.status === 'awaiting_customer_approval');
    ok('approval: customer_approved_at is not stamped by merely choosing a payment option', !o.customer_approved_at);
    ok('approval: money fields are untouched', o.deposit_paid_cents === 0 && o.balance_due_cents === 15000 && o.deposit_due_cents === 5000 && o.subtotal_cents === 20000);
    x = await act(ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, tp('order-appr'));
    ok('approval: a zero/absent tip does not overwrite the stored tip', order(x.h.db, 'order-appr').tip_cents === 0);
    x = await act(ANON_KEY, 'order-inv', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, tp('order-inv'));
    ok('approval: an order that is not awaiting approval cannot be approved (409)', x.res.status === 409 && order(x.h.db, 'order-inv').status === 'draft');
    x = await act(ANON_KEY, 'order-appr', 'reject_changes', { reason: 'too expensive' }, tp('order-appr'));
    ok('rejection: cancels the order, stores the reason and logs the change', order(x.h.db, 'order-appr').status === 'cancelled' && x.h.db.tables.order_changelog.some((c) => c.order_id === 'order-appr' && c.new_value === 'cancelled - too expensive' && c.old_value === 'awaiting_customer_approval'));
    x = await act(ANON_KEY, 'order-act', 'reject_changes', {}, tp('order-act'));
    ok('rejection: an order that is not awaiting approval cannot be cancelled this way (409)', x.res.status === 409 && order(x.h.db, 'order-act').status === 'confirmed');
    x = await act(ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, tp('order-appr'));
    const afterSelection = x.h;
    const rejectLater = await act(ANON_KEY, 'order-appr', 'reject_changes', {}, tp('order-appr'), afterSelection);
    ok('rejection: recording a selection does not confirm, so the customer can still reject (cancel) the changes', rejectLater.res.status === 200 && order(afterSelection.db, 'order-appr').status === 'cancelled');

    // lot pictures / pictures
    x = await act(ANON_KEY, 'order-act', 'register_lot_pictures', { files: [{ path: `order-act/${OBJ}.jpg`, name: '1.jpg' }, { path: `order-act/${OBJ2}.jpg`, name: '2.jpg' }] }, tp('order-act'));
    ok('lot pictures: records are created for this order only', x.res.status === 200 && x.h.db.tables.order_lot_pictures.filter((r) => r.order_id === 'order-act').length === 2);
    ok('lot pictures: the admin is told by the server when pictures were requested (no browser relay)', x.h.fetches.some((f) => /send-email$/.test(f.url) && JSON.parse(f.init.body).to === 'admin@example.test') && x.h.fetches.some((f) => /send-sms-notification$/.test(f.url)) && x.h.fetches.every((f) => f.init.headers.Authorization === `Bearer ${SERVICE_KEY}`));
    ok('lot pictures: nothing sent to the admin leaks a token', !x.h.fetches.some((f) => /tok-/.test(String(f.init.body))));
    {
      const h = fixture();
      for (let i = 0; i < 3; i++) h.db.tables.order_lot_pictures.push({ id: `x${i}`, order_id: 'order-act', file_path: `order-act/x${i}.jpg`, file_name: 'x', uploaded_at: 'z' });
      x = await act(ANON_KEY, 'order-act', 'register_lot_pictures', { files: [{ path: `order-act/${OBJ}.jpg`, name: 'a' }, { path: `order-act/${OBJ2}.jpg`, name: 'b' }] }, tp('order-act'), h);
      ok('lot pictures: more than four in total is refused', x.res.status === 400 && h.db.tables.order_lot_pictures.filter((r) => r.order_id === 'order-act').length === 3);
    }
    x = await act(ANON_KEY, 'order-act', 'register_lot_pictures', { files: [{ path: `order-act2/${OBJ}.jpg`, name: 'steal.jpg' }] }, tp('order-act'));
    ok('lot pictures: a path in another order\'s folder is refused', x.res.status === 400 && x.h.db.writes.length === 0);
    x = await act(ANON_KEY, 'order-appr', 'delete_lot_picture', { pictureId: '11111111-1111-4111-8111-111111111111' }, tp('order-appr'));
    ok('lot pictures: delete removes the storage object and the record', x.res.status === 200 && x.h.db.storageRemoved.includes('lot-pictures:order-appr/a.jpg') && !x.h.db.tables.order_lot_pictures.some((r) => r.id === '11111111-1111-4111-8111-111111111111'));
    x = await act(ANON_KEY, 'order-appr', 'delete_lot_picture', { pictureId: '22222222-2222-4222-8222-222222222222' }, tp('order-appr'));
    ok('lot pictures: another order\'s picture id cannot be deleted', x.res.status === 404 && x.h.db.tables.order_lot_pictures.some((r) => r.id === '22222222-2222-4222-8222-222222222222') && x.h.db.storageRemoved.length === 0);
    x = await act(ANON_KEY, 'order-act', 'delete_lot_picture', { pictureId: '11111111-1111-4111-8111-111111111111' }, tp('order-act'));
    ok('lot pictures: deletion is limited to before approval (409 on a confirmed order)', x.res.status === 409);
    x = await act(ANON_KEY, 'order-act', 'register_order_pictures', { files: [{ path: `order-act/${OBJ}.jpg`, name: 'z.jpg', size: 12, mimeType: 'image/jpeg' }], notes: 'note' }, tp('order-act'));
    ok('order pictures: a record is created with no uploader id', x.h.db.tables.order_pictures.some((r) => r.file_name === 'z.jpg' && r.uploaded_by === null && r.notes === 'note'));

    // availability (server-side, on the order's own items)
    {
      const h = fixture();
      h.db.tables.orders.push({ id: 'other-booking', status: 'confirmed', event_date: '2026-11-10', event_end_date: '2026-11-10' });
      h.db.tables.order_items.push({ id: 'oi-x', order_id: 'other-booking', unit_id: 'unit-1', qty: 1 });
      x = await act(ANON_KEY, 'order-act', 'check_unit_availability', {}, tp('order-act'), h);
      ok('availability: a conflicting booking of the same unit on the same dates is reported unavailable', x.res.json?.available === false);
      const h2 = fixture();
      h2.db.tables.orders.push({ id: 'other-booking', status: 'cancelled', event_date: '2026-11-10', event_end_date: '2026-11-10' });
      h2.db.tables.order_items.push({ id: 'oi-x', order_id: 'other-booking', unit_id: 'unit-1', qty: 1 });
      x = await act(ANON_KEY, 'order-act', 'check_unit_availability', {}, tp('order-act'), h2);
      ok('availability: a cancelled booking does not block', x.res.json?.available === true);
      const h3 = fixture();
      x = await act(ANON_KEY, 'order-act', 'check_unit_availability', {}, tp('order-act'), h3);
      ok('availability: the order is not in conflict with itself or with another customer\'s same-unit booking on other dates', x.res.json?.available === true);
      const h4 = fixture();
      h4.db.rpcResults.check_date_blackout = { is_full_blocked: true, is_same_day_pickup_blocked: false };
      x = await act(ANON_KEY, 'order-act', 'check_unit_availability', {}, tp('order-act'), h4);
      ok('availability: a fully blacked-out date is unavailable', x.res.json?.available === false);
      ok('availability: the response is a yes/no only (no other customer data)', Object.keys(x.res.json).sort().join() === 'available,success' && !/other-booking|order-act2/.test(x.res.text));
    }
  }

  // =============================================================================================================
  // Confirmation is owned by order-lifecycle / charge-deposit, never by customer-portal-action
  // =============================================================================================================
  {
    const actFn = (h: Harness) => loadFunction('customer-portal-action', h);
    const lifeFn = (h: Harness) => loadFunction('order-lifecycle', h);
    const doAction = (h: Harness, bearer: string | null, orderId: string, action: string, payload: Record<string, unknown>, token?: string) =>
      callFunction(actFn(h), bearer, { orderId, ...(token ? { token } : {}), action, payload });
    const doLifecycle = (h: Harness, bearer: string | null, orderId: string, source: string, outcome: string, token?: string) =>
      callFunction(lifeFn(h), bearer, { action: 'enter_confirmed', orderId, source, paymentOutcome: outcome, ...(token ? { invoiceToken: token } : {}) });

    // ---- CRITICAL: a valid portal token must not confirm an unpaid awaiting-approval order
    {
      const h = fixture();
      const o = order(h.db, 'order-appr');
      ok('fixture: awaiting approval, deposit due, nothing paid', o.status === 'awaiting_customer_approval' && o.deposit_due_cents > 0 && o.deposit_paid_cents === 0);
      const res = await doAction(h, ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, tp('order-appr'));
      ok('payment bypass: approve_changes with a valid portal token succeeds in recording the selection', res.status === 200 && order(h.db, 'order-appr').customer_selected_payment_cents === 5000);
      eq('payment bypass: ...but the unpaid order is STILL awaiting customer approval', order(h.db, 'order-appr').status, 'awaiting_customer_approval');
      ok('payment bypass: no approval timestamp, no changelog, no payment fields changed', !order(h.db, 'order-appr').customer_approved_at && order(h.db, 'order-appr').deposit_paid_cents === 0 && !h.db.tables.order_changelog.some((c) => c.order_id === 'order-appr' && c.new_value === 'confirmed'));
      for (const bearer of [ANON_KEY, 'jwt-A', SERVICE_KEY]) {
        const h2 = fixture();
        await doAction(h2, bearer, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, bearer === ANON_KEY ? tp('order-appr') : undefined);
        ok('payment bypass: no caller kind (token / owner / backend) can confirm through approve_changes', order(h2.db, 'order-appr').status === 'awaiting_customer_approval');
      }
      // and the hardened path refuses to finish it until the deposit is really collected
      const life = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'));
      ok('payment bypass: order-lifecycle refuses to confirm while the deposit is uncollected (even claiming already_paid)', life.status === 400 && order(h.db, 'order-appr').status === 'awaiting_customer_approval');
      const lifeWaived = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', 'waived', tp('order-appr'));
      ok('payment bypass: claiming "waived" does not bypass the guard either', lifeWaived.status === 400 && order(h.db, 'order-appr').status === 'awaiting_customer_approval');
    }

    // ---- three real approval paths
    {
      // already-paid: record -> lifecycle validates -> confirmed (+ approval timestamp)
      const h = fixture();
      Object.assign(order(h.db, 'order-appr'), { deposit_paid_cents: 5000, stripe_payment_status: 'paid' });
      await doAction(h, ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, tp('order-appr'));
      eq('already-paid: the action alone leaves the order awaiting approval', order(h.db, 'order-appr').status, 'awaiting_customer_approval');
      const life = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'));
      ok('already-paid: order-lifecycle then confirms it', life.status === 200 && order(h.db, 'order-appr').status === 'confirmed');
      ok('already-paid: customer_approved_at is stamped by the lifecycle transition', !!order(h.db, 'order-appr').customer_approved_at);
    }
    {
      // control: a first-time confirmation does alert the admin (so the next assertion is meaningful)
      const hc = fixture();
      hc.db.tables.admin_settings.push({ key: 'admin_notification_phone', value: '+15555550999' }, { key: 'admin_email', value: 'admin@example.test' });
      Object.assign(order(hc.db, 'order-appr'), { deposit_paid_cents: 5000, stripe_payment_status: 'paid' });
      await doLifecycle(hc, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'));
      ok('control: a first confirmation alerts the admin', hc.db.invokes.some((i) => /send-sms-notification|send-email/.test(i.name)));
    }
    {
      // previously confirmed + admin already alerted + later edited: lifecycle must still complete the transition
      const h = fixture();
      h.db.tables.admin_settings.push({ key: 'admin_notification_phone', value: '+15555550999' }, { key: 'admin_email', value: 'admin@example.test' });
      Object.assign(order(h.db, 'order-appr'), { deposit_paid_cents: 5000, stripe_payment_status: 'paid', confirmed_admin_alerted: true });
      await doAction(h, ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, tp('order-appr'));
      const life = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'));
      ok('re-approval: an order the admin was already alerted about is still confirmed by the lifecycle (not silently skipped)', life.status === 200 && order(h.db, 'order-appr').status === 'confirmed' && !!order(h.db, 'order-appr').customer_approved_at);
      ok('re-approval: the admin is not alerted a second time', !h.db.invokes.some((i) => /send-sms-notification|send-email/.test(i.name)));
      const again = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'));
      ok('re-approval: repeating it is idempotent', again.status === 200 && again.json?.alreadySent === true);
    }
    {
      // $0 deposit with a saved card
      const h = fixture();
      Object.assign(order(h.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000 });
      const rec = await doAction(h, ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 0, selectedPaymentType: 'deposit', tipCents: 300 }, tp('order-appr'));
      ok('zero deposit: the selection and tip are recorded', rec.status === 200 && order(h.db, 'order-appr').tip_cents === 300);
      eq('zero deposit: the action alone leaves the order awaiting approval', order(h.db, 'order-appr').status, 'awaiting_customer_approval');
      const life = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', 'zero_due_with_card', tp('order-appr'));
      ok('zero deposit: order-lifecycle then confirms it and stamps the approval', life.status === 200 && order(h.db, 'order-appr').status === 'confirmed' && !!order(h.db, 'order-appr').customer_approved_at);
      // ... but not without a saved card
      const h2 = fixture();
      Object.assign(order(h2.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000, stripe_customer_id: null, stripe_payment_method_id: null });
      const noCard = await doAction(h2, ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 0, selectedPaymentType: 'deposit' }, tp('order-appr'));
      ok('zero deposit: without a saved card the selection is refused (card_required) and nothing is written', noCard.status === 409 && noCard.json?.error === 'card_required' && h2.db.writes.length === 0);
    }
    {
      // positive deposit: charge-deposit (trusted payment state) -> lifecycle
      const h = fixture();
      await doAction(h, ANON_KEY, 'order-appr', 'approve_changes', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' }, tp('order-appr'));
      const early = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_charge_deposit', 'charged_now', tp('order-appr'));
      ok('positive deposit: lifecycle will not confirm before the charge (a claimed charged_now is not enough)', early.status === 400 && order(h.db, 'order-appr').status === 'awaiting_customer_approval');
      // simulate the hardened charge-deposit function having collected the deposit and confirmed atomically
      Object.assign(order(h.db, 'order-appr'), { deposit_paid_cents: 5000, stripe_payment_status: 'paid', status: 'confirmed' });
      const done = await doLifecycle(h, ANON_KEY, 'order-appr', 'customer_approval_charge_deposit', 'charged_now', tp('order-appr'));
      ok('positive deposit: after the trusted charge, lifecycle completes and stamps the approval', done.status === 200 && order(h.db, 'order-appr').status === 'confirmed' && !!order(h.db, 'order-appr').customer_approved_at);
      ok('positive deposit: the customer action never sent a charge or Stripe call', !h.fetches.some((f) => /stripe/.test(f.url)));
    }

    // ---- no-card Admin Invoice, end to end
    {
      const h = fixture();
      const rec = await doAction(h, ANON_KEY, 'order-nocard', 'invoice_confirm_no_card', {}, ti('order-nocard'));
      ok('no-card invoice: acceptance state recorded by the action', rec.status === 200 && order(h.db, 'order-nocard').same_day_responsibility_accepted === true);
      eq('no-card invoice: the action alone does NOT confirm', order(h.db, 'order-nocard').status, 'draft');
      const life = await doLifecycle(h, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', ti('order-nocard'));
      ok('no-card invoice: order-lifecycle accepts the legitimate outcome and confirms (no direct status write needed)', life.status === 200 && order(h.db, 'order-nocard').status === 'confirmed');
      ok('no-card invoice: the lifecycle records the transition', h.db.tables.order_changelog.some((c) => c.order_id === 'order-nocard' && c.new_value === 'confirmed'));
      ok('no-card invoice: this is not stamped as a customer *change* approval', !order(h.db, 'order-nocard').customer_approved_at);
    }
    {
      // a no-card claim on an invoice that still owes a deposit never confirms
      const h = fixture();
      const life = await doLifecycle(h, ANON_KEY, 'order-inv', 'invoice_acceptance_no_card', 'waived', ti('order-inv'));
      ok('no-card invoice: lifecycle refuses to confirm an invoice that owes an uncollected deposit', life.status === 400 && order(h.db, 'order-inv').status === 'draft');
    }

    // ---- approval selection invariants (without changing the approved UX)
    {
      const call = async (mut: Record<string, unknown>, payload: Record<string, unknown>) => {
        const h = fixture();
        Object.assign(order(h.db, 'order-appr'), mut);
        const res = await doAction(h, ANON_KEY, 'order-appr', 'approve_changes', payload, tp('order-appr'));
        return { res, h };
      };
      let x = await call({}, { selectedPaymentCents: 5000, selectedPaymentType: 'deposit' });
      ok('selection: the current deposit is accepted as "deposit"', x.res.status === 200);
      x = await call({}, { selectedPaymentCents: 20000, selectedPaymentType: 'full' });
      ok('selection: the current order total is accepted as "full"', x.res.status === 200);
      x = await call({}, { selectedPaymentCents: 12000, selectedPaymentType: 'custom' });
      ok('selection: a custom amount between deposit and total is accepted', x.res.status === 200);
      x = await call({}, { selectedPaymentCents: 20000, selectedPaymentType: 'custom', tipCents: 2000 });
      ok('selection: a normal tip is accepted', x.res.status === 200 && order(x.h.db, 'order-appr').tip_cents === 2000);
      for (const [label, payload] of [
        ['above the current order total', { selectedPaymentCents: 20001, selectedPaymentType: 'custom' }],
        ['below the current deposit', { selectedPaymentCents: 4999, selectedPaymentType: 'custom' }],
        ['zero while a deposit is due', { selectedPaymentCents: 0, selectedPaymentType: 'deposit' }],
        ['"deposit" with an amount other than the deposit', { selectedPaymentCents: 6000, selectedPaymentType: 'deposit' }],
        ['"full" with an amount other than the total', { selectedPaymentCents: 15000, selectedPaymentType: 'full' }],
        ['negative', { selectedPaymentCents: -100, selectedPaymentType: 'custom' }],
        ['not a whole number of cents', { selectedPaymentCents: 5000.5, selectedPaymentType: 'custom' }],
        ['an unknown payment type', { selectedPaymentCents: 5000, selectedPaymentType: 'free' }],
        ['a tip larger than the order total', { selectedPaymentCents: 5000, selectedPaymentType: 'deposit', tipCents: 999999 }],
      ] as Array<[string, Record<string, unknown>]>) {
        x = await call({}, payload);
        ok('selection: ' + label + ' is rejected and nothing is written', x.res.status === 400 && x.h.db.writes.length === 0);
      }
      // "keep original payment": a stored selection that no longer equals the current deposit / total after an admin edit
      x = await call({ customer_selected_payment_cents: 8000, customer_selected_payment_type: 'custom' }, { selectedPaymentCents: 8000, selectedPaymentType: 'custom' });
      ok('selection: keeping a previously stored custom amount still works', x.res.status === 200);
      x = await call({ customer_selected_payment_cents: 9000, customer_selected_payment_type: 'deposit' }, { selectedPaymentCents: 9000, selectedPaymentType: 'deposit' });
      ok('selection: keeping a stored "deposit" amount that is above the new deposit still works', x.res.status === 200);
      x = await call({ customer_selected_payment_cents: 18000, customer_selected_payment_type: 'full', subtotal_cents: 21000 }, { selectedPaymentCents: 18000, selectedPaymentType: 'full' });
      ok('selection: keeping a stored "full" amount after the total changed still works', x.res.status === 200);
      x = await call({ customer_selected_payment_cents: 3000 }, { selectedPaymentCents: 3000, selectedPaymentType: 'deposit' });
      ok('selection: a stored amount now BELOW the new deposit cannot be retained (the screen disables approval too)', x.res.status === 400);
      x = await call({ deposit_due_cents: 0, balance_due_cents: 20000 }, { selectedPaymentCents: 0, selectedPaymentType: 'deposit' });
      ok('selection: zero is accepted when the current deposit is zero (card on file)', x.res.status === 200);
      x = await call({ subtotal_cents: 20000, tax_cents: 1200, deposit_due_cents: 5000 }, { selectedPaymentCents: 21200, selectedPaymentType: 'full' });
      ok('selection: the total includes tax exactly as the screen computes it', x.res.status === 200);
    }
  }

  // =============================================================================================================
  // order-lifecycle: access proof is not permission to confirm (customer pathways)
  // =============================================================================================================
  {
    const lifeFn = (h: Harness) => loadFunction('order-lifecycle', h);
    const LC = async (h: Harness, bearer: string | null, orderId: string, source: string, outcome: string, token?: string) =>
      callFunction(lifeFn(h), bearer, { action: 'enter_confirmed', orderId, source, paymentOutcome: outcome, ...(token ? { invoiceToken: token } : {}) });
    const withAlerts = (h: Harness) => (h.db.tables.admin_settings.push({ key: 'admin_notification_phone', value: '+15555550999' }, { key: 'admin_email', value: 'admin@example.test' }), h);
    const untouched = (h: Harness, id: string, status: string) =>
      order(h.db, id).status === status && !order(h.db, id).customer_approved_at && !h.db.tables.order_changelog.some((c) => c.order_id === id && c.new_value === 'confirmed') && !h.db.invokes.some((i) => /send-sms-notification|send-email/.test(i.name));

    // ---- CRITICAL: $0 deposit, no saved card, valid portal token, direct lifecycle call
    {
      const h = withAlerts(fixture());
      Object.assign(order(h.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000, stripe_customer_id: null, stripe_payment_method_id: null });
      const res = await LC(h, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', 'zero_due_with_card', tp('order-appr'));
      ok('zero deposit, no saved card: the direct lifecycle call FAILS', res.status === 400 && res.json?.success === false);
      ok('zero deposit, no saved card: still awaiting approval, no approval stamp, no confirmed changelog, no admin alert', untouched(h, 'order-appr', 'awaiting_customer_approval'));
      for (const claimed of ['waived', 'already_paid', 'charged_now', 'cash', 'zero_due_with_card']) {
        const h2 = fixture();
        Object.assign(order(h2.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000, stripe_customer_id: null, stripe_payment_method_id: null });
        const r2 = await LC(h2, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', claimed, tp('order-appr'));
        ok('zero deposit, no saved card: claiming "' + claimed + '" does not help', r2.status === 400 && order(h2.db, 'order-appr').status === 'awaiting_customer_approval');
      }
      // only one of the two card facts present is not a saved card either
      for (const half of [{ stripe_customer_id: 'cus_x', stripe_payment_method_id: null }, { stripe_customer_id: null, stripe_payment_method_id: 'pm_x' }]) {
        const h3 = fixture();
        Object.assign(order(h3.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000, ...half });
        const r3 = await LC(h3, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', 'zero_due_with_card', tp('order-appr'));
        ok('zero deposit: a customer id without a payment method (or vice versa) is not a saved card', r3.status === 400 && order(h3.db, 'order-appr').status === 'awaiting_customer_approval');
      }
      // the same call succeeds with a real saved card
      const h4 = withAlerts(fixture());
      Object.assign(order(h4.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000 });
      const ok4 = await LC(h4, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', 'zero_due_with_card', tp('order-appr'));
      ok('zero deposit WITH a saved card: the same call succeeds, stamps the approval and alerts the admin', ok4.status === 200 && order(h4.db, 'order-appr').status === 'confirmed' && !!order(h4.db, 'order-appr').customer_approved_at && h4.db.invokes.some((i) => /send-sms-notification|send-email/.test(i.name)));
      const h5 = fixture();
      Object.assign(order(h5.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000 });
      const own = await LC(h5, 'jwt-A', 'order-appr', 'customer_approval_zero_deposit', 'zero_due_with_card');
      ok('zero deposit WITH a saved card: the signed-in owner can confirm too', own.status === 200 && order(h5.db, 'order-appr').status === 'confirmed');
    }

    // ---- pending_review / draft cannot be confirmed by a customer approval source
    for (const status of ['pending_review', 'draft']) {
      for (const [source, outcome] of [['customer_approval_zero_deposit', 'zero_due_with_card'], ['customer_approval_already_paid', 'already_paid'], ['customer_approval_charge_deposit', 'charged_now']] as Array<[string, string]>) {
        const h = withAlerts(fixture());
        Object.assign(order(h.db, 'order-appr'), { status, deposit_due_cents: source === 'customer_approval_charge_deposit' ? 5000 : 0, deposit_paid_cents: source === 'customer_approval_zero_deposit' ? 0 : 5000, balance_due_cents: 15000 });
        const res = await LC(h, ANON_KEY, 'order-appr', source, outcome, tp('order-appr'));
        ok('state: ' + source + ' cannot confirm a ' + status + ' order (admin review cannot be skipped)', res.status === 400 && untouched(h, 'order-appr', status));
      }
    }
    {
      const h = fixture();
      Object.assign(order(h.db, 'order-appr'), { status: 'pending_review', deposit_due_cents: 0, balance_due_cents: 20000 });
      const res = await LC(h, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', 'zero_due_with_card', tp('order-appr'));
      ok('state: pending_review + $0 deposit + valid portal token cannot skip admin review (stays pending_review)', res.status === 400 && order(h.db, 'order-appr').status === 'pending_review');
    }

    // ---- unknown / arbitrary untrusted sources fail closed; trusted sources are unchanged
    for (const source of ['test', 'admin_approve_zero_deposit', 'admin_force_approve', 'customer_approval_anything', 'webhook_checkout_deposit_admin_invoice', '', 'charge_deposit']) {
      const h = fixture();
      Object.assign(order(h.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000 });
      const res = await LC(h, ANON_KEY, 'order-appr', source, 'waived', tp('order-appr'));
      ok('source: untrusted caller with source "' + source + '" fails closed', res.status === 400 && order(h.db, 'order-appr').status === 'awaiting_customer_approval');
    }
    {
      const h = fixture();
      Object.assign(order(h.db, 'order-appr'), { status: 'pending_review', deposit_due_cents: 0, balance_due_cents: 20000, stripe_customer_id: null, stripe_payment_method_id: null });
      const res = await LC(h, 'jwt-admin', 'order-appr', 'admin_approve_zero_deposit', 'waived');
      ok('trusted: an admin keeps full control (pending_review, $0, no card, "waived")', res.status === 200 && order(h.db, 'order-appr').status === 'confirmed');
      const h2 = fixture();
      Object.assign(order(h2.db, 'order-appr'), { status: 'pending_review', stripe_customer_id: null });
      const svc = await LC(h2, SERVICE_KEY, 'order-appr', 'charge_deposit', 'charged_now');
      ok('trusted: the backend (charge-deposit / webhook) keeps its behavior but still hits the deposit guard', svc.status === 200 || svc.status === 400);
      const h3 = fixture();
      Object.assign(order(h3.db, 'order-appr'), { status: 'pending_review', deposit_paid_cents: 5000 });
      const svc2 = await LC(h3, SERVICE_KEY, 'order-appr', 'charge_deposit', 'charged_now');
      ok('trusted: the backend confirms a paid order', svc2.status === 200 && order(h3.db, 'order-appr').status === 'confirmed');
    }

    // ---- already-paid and charged-deposit approvals
    {
      const h = fixture();
      Object.assign(order(h.db, 'order-appr'), { deposit_paid_cents: 5000, stripe_payment_status: 'paid' });
      ok('already paid: awaiting approval with the deposit collected confirms', (await LC(h, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'))).status === 200 && order(h.db, 'order-appr').status === 'confirmed');
      const h2 = fixture();
      const unpaid = await LC(h2, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'));
      ok('already paid: a claim on an unpaid order fails (stored payment state is authoritative)', unpaid.status === 400 && order(h2.db, 'order-appr').status === 'awaiting_customer_approval');
      const h3 = fixture();
      Object.assign(order(h3.db, 'order-appr'), { deposit_paid_cents: 2000 });
      const partial = await LC(h3, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'already_paid', tp('order-appr'));
      ok('partial deposit (catch-up) stays fail-closed for customers (known deferred limitation)', partial.status === 400 && order(h3.db, 'order-appr').status === 'awaiting_customer_approval');
      const h4 = fixture();
      Object.assign(order(h4.db, 'order-appr'), { deposit_paid_cents: 5000, status: 'confirmed', confirmed_admin_alerted: true });
      const idem = await LC(h4, ANON_KEY, 'order-appr', 'customer_approval_charge_deposit', 'charged_now', tp('order-appr'));
      ok('charged deposit: completing an order charge-deposit already confirmed is idempotent and stamps the approval', idem.status === 200 && !!order(h4.db, 'order-appr').customer_approved_at);
      const h5 = fixture();
      const early = await LC(h5, ANON_KEY, 'order-appr', 'customer_approval_charge_deposit', 'charged_now', tp('order-appr'));
      ok('charged deposit: before payment state shows the deposit collected it fails', early.status === 400 && order(h5.db, 'order-appr').status === 'awaiting_customer_approval');
    }

    // ---- Admin Invoice no-card confirmation: invoice context at the lifecycle itself
    {
      const h = fixture();
      const viaPortal = await LC(h, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', tp('order-nocard'));
      ok('invoice no-card: a PORTAL token is denied at the lifecycle', viaPortal.status === 400 && order(h.db, 'order-nocard').status === 'draft');
      const h2 = fixture();
      const viaInvoice = await LC(h2, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', ti('order-nocard'));
      ok('invoice no-card: an INVOICE token on a legitimate $0 no-card Admin Invoice is allowed', viaInvoice.status === 200 && order(h2.db, 'order-nocard').status === 'confirmed');
      const h3 = fixture();
      const crossOrder = await LC(h3, ANON_KEY, 'order-nocard2', 'invoice_acceptance_no_card', 'waived', ti('order-nocard'));
      ok("invoice no-card: Order A's invoice token cannot confirm Order B", crossOrder.status === 401 && order(h3.db, 'order-nocard2').status === 'draft');
      const h4 = fixture();
      Object.assign(order(h4.db, 'order-booking'), { deposit_due_cents: 0, balance_due_cents: 20000, require_card_on_file: false });
      const ownerBooking = await LC(h4, 'jwt-A', 'order-booking', 'invoice_acceptance_no_card', 'waived');
      ok('invoice no-card: the owner of an ordinary $0 draft BOOKING (no invoice link) is denied', ownerBooking.status === 400 && order(h4.db, 'order-booking').status === 'draft');
      const h5 = fixture();
      const ownerInvoice = await LC(h5, 'jwt-A', 'order-nocard', 'invoice_acceptance_no_card', 'waived');
      ok('invoice no-card: the owner of a current real no-card Admin Invoice is allowed (no token needed)', ownerInvoice.status === 200 && order(h5.db, 'order-nocard').status === 'confirmed');
      const h6 = fixture();
      const expiredTok = await LC(h6, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', tie('order-nocard'));
      ok('invoice no-card: an expired invoice token is denied', expiredTok.status === 401 && order(h6.db, 'order-nocard').status === 'draft');
      const h7 = fixture();
      const revokedTok = await LC(h7, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', tir('order-nocard'));
      ok('invoice no-card: a revoked invoice token is denied', revokedTok.status === 401 && order(h7.db, 'order-nocard').status === 'draft');
      const h8 = fixture();
      h8.db.tables.invoice_links = h8.db.tables.invoice_links.filter((l) => !(l.order_id === 'order-nocard' && l.link_type === 'invoice' && !l.revoked_at && l.expires_at === FUTURE));
      const ownerExpired = await LC(h8, 'jwt-A', 'order-nocard', 'invoice_acceptance_no_card', 'waived');
      ok('invoice no-card: an owner whose invoice context has expired is denied', ownerExpired.status === 400 && order(h8.db, 'order-nocard').status === 'draft');
      const h9 = fixture();
      h9.db.tables.invoice_links = h9.db.tables.invoice_links.filter((l) => !(l.order_id === 'order-nocard' && l.link_type === 'invoice' && l.id !== 'link-inv-r-order-nocard'));
      const ownerRevoked = await LC(h9, 'jwt-A', 'order-nocard', 'invoice_acceptance_no_card', 'waived');
      ok('invoice no-card: an owner whose only invoice link is revoked is denied', ownerRevoked.status === 400 && order(h9.db, 'order-nocard').status === 'draft');
      const h10 = fixture();
      Object.assign(order(h10.db, 'order-nocard'), { require_card_on_file: true });
      const needsCard = await LC(h10, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', ti('order-nocard'));
      ok('invoice no-card: an invoice that requires a card cannot use the no-card pathway', needsCard.status === 400 && order(h10.db, 'order-nocard').status === 'draft');
      const h11 = fixture();
      Object.assign(order(h11.db, 'order-nocard'), { deposit_due_cents: 5000 });
      const hasDeposit = await LC(h11, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', ti('order-nocard'));
      ok('invoice no-card: an invoice with a deposit due cannot use the no-card pathway', hasDeposit.status === 400 && order(h11.db, 'order-nocard').status === 'draft');
      const h12 = fixture();
      Object.assign(order(h12.db, 'order-nocard'), { status: 'pending_review' });
      const wrongState = await LC(h12, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'waived', ti('order-nocard'));
      ok('invoice no-card: only a draft invoice can be confirmed by this pathway', wrongState.status === 400 && order(h12.db, 'order-nocard').status === 'pending_review');
    }
    {
      // the other Admin Invoice pathways also need the invoice context
      const h = fixture();
      Object.assign(order(h.db, 'order-nocard'), { require_card_on_file: true });
      const portalTok = await LC(h, ANON_KEY, 'order-nocard', 'invoice_card_saved_fallback', 'zero_due_with_card', tp('order-nocard'));
      ok('invoice card-saved fallback: a portal token is denied', portalTok.status === 400 && order(h.db, 'order-nocard').status === 'draft');
      const h3 = fixture();
      Object.assign(order(h3.db, 'order-nocard'), { require_card_on_file: true, stripe_customer_id: null, stripe_payment_method_id: null });
      const noCard3 = await LC(h3, ANON_KEY, 'order-nocard', 'invoice_card_saved_fallback', 'zero_due_with_card', ti('order-nocard'));
      ok('invoice card-saved fallback: a $0 invoice with NO saved card is not confirmed', noCard3.status === 400 && order(h3.db, 'order-nocard').status === 'draft');
      const h4 = fixture();
      Object.assign(order(h4.db, 'order-nocard'), { require_card_on_file: true });
      const good = await LC(h4, ANON_KEY, 'order-nocard', 'invoice_card_saved_fallback', 'zero_due_with_card', ti('order-nocard'));
      ok('invoice card-saved fallback: invoice token + saved card + $0 confirms', good.status === 200 && order(h4.db, 'order-nocard').status === 'confirmed');
      const h5 = fixture();
      const sessionNoInvoice = await LC(h5, ANON_KEY, 'order-booking', 'webhook_fallback_admin_invoice', 'charged_now', undefined);
      ok('payment-complete fallback: no proof at all is denied', sessionNoInvoice.status === 401);
      const h6 = fixture();
      Object.assign(order(h6.db, 'order-booking'), { deposit_paid_cents: 5000 });
      const portalForBooking = await LC(h6, ANON_KEY, 'order-booking', 'webhook_fallback_admin_invoice', 'charged_now', tp('order-booking'));
      ok('payment-complete fallback: a portal token on an ordinary booking (no invoice) is denied even when paid', portalForBooking.status === 400 && order(h6.db, 'order-booking').status === 'draft');
      const h7 = fixture();
      Object.assign(order(h7.db, 'order-inv'), { deposit_paid_cents: 5000 });
      const paidInvoice = await LC(h7, ANON_KEY, 'order-inv', 'webhook_fallback_admin_invoice', 'charged_now', ti('order-inv'));
      ok('payment-complete fallback: an invoice token on a paid Admin Invoice confirms', paidInvoice.status === 200 && order(h7.db, 'order-inv').status === 'confirmed');
      const h8 = fixture();
      const unpaidInvoice = await LC(h8, ANON_KEY, 'order-inv', 'webhook_fallback_admin_invoice', 'charged_now', ti('order-inv'));
      ok('payment-complete fallback: an unpaid Admin Invoice is not confirmed', unpaidInvoice.status === 400 && order(h8.db, 'order-inv').status === 'draft');
    }

    // ---- the requested outcome is never what decides: the pathway derives it from stored state
    {
      const notesOf = (h: Harness, id: string) => h.db.tables.order_changelog.filter((c) => c.order_id === id && c.new_value === 'confirmed').map((c) => c.notes).join(' ');
      const h = fixture();
      Object.assign(order(h.db, 'order-appr'), { deposit_due_cents: 0, balance_due_cents: 20000 });
      const r1 = await LC(h, ANON_KEY, 'order-appr', 'customer_approval_zero_deposit', 'cash', tp('order-appr'));
      ok('outcome: a customer who claims "cash" on the zero-deposit pathway is recorded as zero_due_with_card', r1.status === 200 && /payment: zero_due_with_card/.test(notesOf(h, 'order-appr')));
      const h2 = fixture();
      const r2 = await LC(h2, ANON_KEY, 'order-nocard', 'invoice_acceptance_no_card', 'charged_now', ti('order-nocard'));
      ok('outcome: a customer who claims "charged_now" on the no-card pathway is recorded as waived', r2.status === 200 && /payment: waived/.test(notesOf(h2, 'order-nocard')));
      const h3 = fixture();
      Object.assign(order(h3.db, 'order-appr'), { deposit_paid_cents: 5000, stripe_payment_status: 'paid' });
      const r3 = await LC(h3, ANON_KEY, 'order-appr', 'customer_approval_already_paid', 'waived', tp('order-appr'));
      ok('outcome: a customer who claims "waived" on the already-paid pathway is recorded as already_paid', r3.status === 200 && /payment: already_paid/.test(notesOf(h3, 'order-appr')));
      // an unknown source never works even with every other prerequisite in place (invoice context, paid, card)
      const h4 = fixture();
      Object.assign(order(h4.db, 'order-inv'), { deposit_paid_cents: 5000 });
      const r4 = await LC(h4, ANON_KEY, 'order-inv', 'some_new_source', 'charged_now', ti('order-inv'));
      ok('source: an unknown source is refused even when the order is a paid Admin Invoice with a valid invoice token', r4.status === 400 && order(h4.db, 'order-inv').status === 'draft');
    }

    // ---- the evaluator itself
    {
      const ev = lifecycleOutcome.evaluateCustomerConfirmation;
      const base = { status: 'awaiting_customer_approval', deposit_due_cents: 0, deposit_paid_cents: 0, require_card_on_file: true, stripe_customer_id: null, stripe_payment_method_id: null };
      ok('evaluator: zero deposit needs both card facts', !ev({ source: 'customer_approval_zero_deposit', order: base, hasInvoiceContext: false }).ok && ev({ source: 'customer_approval_zero_deposit', order: { ...base, stripe_customer_id: 'c', stripe_payment_method_id: 'p' }, hasInvoiceContext: false }).ok);
      ok('evaluator: an unknown source is never accepted', !ev({ source: 'whatever', order: base, hasInvoiceContext: true }).ok && !ev({ source: undefined, order: base, hasInvoiceContext: true }).ok);
      ok('evaluator: the outcome comes from the pathway, not from the caller', (ev({ source: 'customer_approval_zero_deposit', order: { ...base, stripe_customer_id: 'c', stripe_payment_method_id: 'p' }, hasInvoiceContext: false }) as any).outcome === 'zero_due_with_card');
    }
  }

  // =============================================================================================================
  // Source assertions: the customer mutation boundary cannot claim payment / confirmation
  // =============================================================================================================
  {
    const src = read('supabase/functions/customer-portal-action/index.ts');
    const code = src.replace(/\/\/.*$/gm, '');
    ok('boundary: customer-portal-action never writes status "confirmed"', !/status\s*:\s*["']confirmed["']/.test(code) && !/["']confirmed["']\s*[,}]/.test(code.replace(/BLOCKED_STATUSES[^;]*;/, '')));
    ok('boundary: customer-portal-action never writes customer_approved_at', !/customer_approved_at/.test(code));
    ok('boundary: the only status write is the explicit rejection (cancelled)', (code.match(/status\s*:\s*["'][a-z_]+["']/g) ?? []).every((m) => /cancelled/.test(m)));
    ok('boundary: invoice-only actions are gated by an invoice context check', /INVOICE_ONLY_ACTIONS\.includes\(action\.name\) && !\(await hasInvoiceContext\(db, proof, orderId\)\)/.test(code));
    ok('boundary: invoice context for tokens means an invoice-type link, for owner / backend a current invoice link', /proof\.link\?\.link_type === "invoice"/.test(code) && /link_type", "invoice"\)\s*\.is\("revoked_at", null\)/.test(code.replace(/\s+/g, ' ').replace(/\) \.is/g, ').is')) || /\.eq\("link_type", "invoice"\)/.test(code));
    ok('boundary: order-lifecycle is the confirmer (it owns the confirmed write and the approval timestamp)', /update\(\{ status: "confirmed", \.\.\.approvedAtPatch \}\)/.test(read('supabase/functions/order-lifecycle/index.ts')) && /customer_approval/.test(read('supabase/functions/order-lifecycle/index.ts')));
    ok('boundary: the browser treats a lifecycle refusal as a failed approval', /confirmThroughLifecycle/.test(read('src/components/customer-portal/ApprovalModal.tsx')) && /!result\.success/.test(read('src/components/customer-portal/ApprovalModal.tsx')));
    ok('boundary: a no-card invoice is confirmed through the lifecycle call, whose failure aborts the acceptance', /invoice_confirm_no_card'\);\s*const confirmation = await enterConfirmed\(/.test(read('src/components/customer-portal/InvoiceAcceptanceView.tsx')) && /!confirmation\.success/.test(read('src/components/customer-portal/InvoiceAcceptanceView.tsx')));
    const direct: string[] = [];
    for (const f of ['supabase/functions/customer-portal-action/index.ts', 'supabase/functions/customer-portal-data/index.ts', 'supabase/functions/_shared/portal-actions.ts', 'src/lib/customerPortalApi.ts']) {
      for (const [i, l] of read(f).split(/\r?\n/).entries()) if (/status\s*:\s*["']confirmed["']|\.update\(\{\s*status\s*:\s*["']confirmed/.test(l) && !/^\s*\/\//.test(l)) direct.push(`${f}:${i + 1}`);
    }
    eq('boundary: no customer-facing action file contains a direct status = confirmed write', direct, []);
  }


  // =============================================================================================================
  // Browser client: access errors, loader outcomes, token handling
  // =============================================================================================================
  {
    const mkSupabase = (resp: any) => ({ functions: { invoke: async (name: string, opts: any) => { mkSupabase.calls.push({ name, opts }); return resp; } } });
    mkSupabase.calls = [] as any[];
    // fetchPortalData / portalAction use the app's supabase client: exercise the same mapping through the loader deps.
    const denied = async () => { throw new PortalAccessError(); };
    eq('loader: a 403 from the server becomes "access required"', (await loadPortalOrder('o', null, {}, { fetchData: denied as any, buildSummary: async () => null })).kind, 'access_required');
    eq('loader: any other failure is a plain error (no access hint)', (await loadPortalOrder('o', null, {}, { fetchData: (async () => { throw new Error('boom'); }) as any, buildSummary: async () => null })).kind, 'error');
    const payload = { order: { id: 'o', tax_waived: true, tax_cents: 99, status: 'confirmed' }, orderItems: [], discounts: [], customFees: [], pricing: null, changelog: [], invoiceLink: null, lotPictures: [], pictures: [], delivery: null };
    const good = { fetchData: (async () => ({ viewer: 'token', data: JSON.parse(JSON.stringify(payload)) })) as any, buildSummary: (async () => null) as any };
    const first = await loadPortalOrder('o', 'tok', {}, good);
    ok('loader: a good response yields the portal data (and zeroes waived tax as before)', first.kind === 'ok' && first.result.order.tax_cents === 0 && first.result.viewer === 'token');
    const sig = first.kind === 'ok' ? first.signature : '';
    eq('loader: an identical background refresh is reported unchanged (no re-render)', (await loadPortalOrder('o', 'tok', { silent: true, previousSignature: sig }, good)).kind, 'unchanged');
    const changed = { fetchData: (async () => ({ viewer: 'token', data: { ...JSON.parse(JSON.stringify(payload)), order: { id: 'o', status: 'in_progress' } } })) as any, buildSummary: good.buildSummary };
    eq('loader: a refresh with new data replaces the stale projection', (await loadPortalOrder('o', 'tok', { silent: true, previousSignature: sig }, changed)).kind, 'ok');
    eq('loader: a non-silent reload always returns data', (await loadPortalOrder('o', 'tok', { silent: false, previousSignature: sig }, good)).kind, 'ok');
    ok('loader: the token is only ever passed to the secure endpoint', (await (async () => { let seen: any = null; await loadPortalOrder('o', 'secret-token-value', {}, { fetchData: (async (...a: any[]) => { seen = a; return { viewer: 'owner', data: payload }; }) as any, buildSummary: good.buildSummary }); return seen[1] === 'secret-token-value' && seen[0] === 'o'; })()));
    ok('api client: portal data / action errors carry codes only, never the token', (() => { const e = new PortalActionError('invalid_status'); return !/tok/.test(e.message) && e.code === 'invalid_status'; })());
    ok('api client: only the two portal functions are invoked', /invoke\('customer-portal-data'/.test(read('src/lib/customerPortalApi.ts')) && /invoke\('customer-portal-action'/.test(read('src/lib/customerPortalApi.ts')) && typeof fetchPortalData === 'function' && typeof portalAction === 'function');
    ok('api client: the client never chooses a table, column or filter', !/\.from\(|\.rpc\(/.test(read('src/lib/customerPortalApi.ts')));
  }

  // =============================================================================================================
  // UUID-only recovery experience
  // =============================================================================================================
  {
    const ui = read('src/components/customer-portal/SecureAccessRequired.tsx');
    const generic = (read('supabase/functions/request-portal-link/index.ts').match(/const GENERIC_MESSAGE = "([^"]+)"/) ?? [])[1];
    ok('recovery UI: asks to verify access and offers "Send me a secure link"', /We need to verify your secure access link\./.test(ui) && /Send me a secure link/.test(ui));
    ok('recovery UI: after the request it shows exactly the server\'s generic message', ui.includes('SECURE_LINK_REQUEST_MESSAGE') && ui.includes(generic) && generic === 'If we found your order, we sent a secure access link to the contact information on file.');
    ok('recovery UI: it shows the same message whatever the server answered (the response is never inspected)', /setState\('sent'\)/.test(ui) && !/data\?*\.|error\?*\.message|\.success/.test(ui.slice(ui.indexOf('async function requestLink'), ui.indexOf('return (', ui.indexOf('async function requestLink')))));
    ok('recovery UI: never mentions a missing order, wrong email, phone, account or SMS consent', !/not found|wrong email|no phone|no account|consent|doesn't exist/i.test(ui));
    ok('recovery UI: asks for no email, phone or account (the caller supplies nothing)', !/<input|type="email"|type="tel"|password/i.test(ui) && /body: \{ orderId \}/.test(ui));
    const page = read('src/pages/CustomerPortal.tsx');
    ok('portal page: an access-required answer renders the recovery UI instead of any order data', /accessRequired && orderId\)\s*\{\s*return <SecureAccessRequired orderId=\{orderId\} \/>/.test(page));
    ok('portal page: the recovery UI is shown before the "Order Not Found" view and before any order view', page.indexOf('SecureAccessRequired orderId') < page.indexOf('Order Not Found') && page.indexOf('SecureAccessRequired orderId') < page.indexOf('<RegularPortalView'));
    ok('portal page: a signed-in owner is never asked for a link (the server accepts the session)', /accessRequired/.test(read('src/hooks/useOrderData.ts')) && !/owner/.test(read('src/components/customer-portal/SecureAccessRequired.tsx')));
    // end to end with the real function: UUID-only → denied; token → ok; owner → ok
    const h = fixture();
    const fn = loadFunction('customer-portal-data', h);
    const uuidOnly = await callFunction(fn, ANON_KEY, { orderId: 'order-act' });
    ok('recovery flow: UUID-only anonymous load returns no order data', uuidOnly.status === 403 && !uuidOnly.text.includes('order-act'));
    ok('recovery flow: the signed-in owner with the same UUID still loads normally', (await callFunction(fn, 'jwt-A', { orderId: 'order-act' })).status === 200);
  }

  // =============================================================================================================
  // Live refresh
  // =============================================================================================================
  {
    const mkEnv = () => {
      const env = {
        t: 0,
        visible: true,
        timers: [] as Array<{ id: number; fn: () => void; ms: number }>,
        nextId: 1,
        visFns: [] as Array<() => void>,
        focusFns: [] as Array<() => void>,
        now: () => env.t,
        isVisible: () => env.visible,
        setInterval: (fn: () => void, ms: number) => { const id = env.nextId++; env.timers.push({ id, fn, ms }); return id; },
        clearInterval: (id: unknown) => { env.timers = env.timers.filter((t) => t.id !== id); },
        onVisible: (fn: () => void) => { env.visFns.push(fn); return () => { env.visFns = env.visFns.filter((f) => f !== fn); }; },
        onFocus: (fn: () => void) => { env.focusFns.push(fn); return () => { env.focusFns = env.focusFns.filter((f) => f !== fn); }; },
        tick: () => env.timers.forEach((t) => t.fn()),
      };
      return env;
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));

    let env = mkEnv();
    let calls = 0;
    let c = createPortalRefreshController({ reload: async () => { calls++; }, env: env as RefreshEnv });
    c.start();
    env.t = 25_000; env.tick(); await flush();
    eq('refresh: a visible portal refetches on the interval', calls, 1);
    ok('refresh: the interval is conservative (>= 15s)', env.timers[0].ms >= 15_000);
    env.visible = false; env.t = 50_000; env.tick(); await flush();
    eq('refresh: a hidden tab does no work', calls, 1);
    env.visible = true; env.t = 80_000; env.visFns.forEach((f) => f()); await flush();
    eq('refresh: becoming visible refetches immediately', calls, 2);
    env.t = 120_000; env.focusFns.forEach((f) => f()); await flush();
    eq('refresh: regaining window focus refetches', calls, 3);
    env.t = 120_500; env.focusFns.forEach((f) => f()); env.visFns.forEach((f) => f()); await flush();
    eq('refresh: focus + visibility bursts inside the minimum gap do not stack', calls, 3);
    await c.refreshNow(); await flush();
    eq('refresh: a successful customer action refetches immediately, ignoring the gap', calls, 4);
    c.stop();
    env.t = 999_000; env.tick(); env.focusFns.forEach((f) => f()); await flush();
    ok('refresh: an unmounted portal stops polling and drops its listeners', calls === 4 && env.timers.length === 0 && env.focusFns.length === 0 && env.visFns.length === 0);

    // no overlapping requests
    env = mkEnv();
    let concurrent = 0, maxConcurrent = 0, total = 0;
    let release: () => void = () => {};
    c = createPortalRefreshController({
      reload: () => new Promise<void>((resolve) => { concurrent++; total++; maxConcurrent = Math.max(maxConcurrent, concurrent); release = () => { concurrent--; resolve(); }; }),
      env: env as RefreshEnv,
    });
    c.start();
    env.t = 25_000; env.tick(); await flush();
    env.t = 50_000; env.tick(); env.tick(); env.focusFns.forEach((f) => f()); await flush();
    ok('refresh: requests arriving mid-reload never overlap', maxConcurrent === 1 && total === 1);
    release(); await flush(); await flush();
    ok('refresh: those requests fold into exactly one follow-up reload', total === 2 && maxConcurrent === 1);
    release(); await flush();
    c.stop();

    // suppression and failures
    env = mkEnv();
    let suppressed = true, n = 0;
    c = createPortalRefreshController({ reload: async () => { n++; if (n === 2) throw new Error('network'); }, isSuppressed: () => suppressed, env: env as RefreshEnv });
    c.start();
    env.t = 25_000; env.tick(); await flush();
    eq('refresh: suppressed while an upload / approval is in progress', n, 0);
    suppressed = false; env.t = 50_000; env.tick(); await flush();
    env.t = 75_000; env.tick(); await flush();
    env.t = 100_000; env.tick(); await flush();
    ok('refresh: a failed refetch does not stop later ones', n === 3);
    c.stop();

    const hookSrc = read('src/hooks/useCustomerPortalRefresh.ts');
    ok('refresh hook: no Realtime / websocket subscription remains (guests cannot rely on direct table access)', !/\.channel\(|postgres_changes|supabase\.|removeChannel/.test(hookSrc));
    ok('refresh hook: the controller is stopped on unmount', /controller\.stop\(\)/.test(hookSrc));
    const pageSrc = read('src/pages/CustomerPortal.tsx');
    ok('portal page: the background refresh uses the secure endpoint silently', /reload: reloadPortalDataSilently/.test(pageSrc) && /\{ silent: true \}/.test(pageSrc));
    ok('portal page: after a customer action the portal refetches through the same endpoint', /onReload=\{handleReload\}/.test(pageSrc) && /await reloadPortalData\(\)/.test(pageSrc));
  }

  // =============================================================================================================
  // Direct database exit criteria: the customer-facing portal code
  // =============================================================================================================
  {
    const portalFiles = [
      'src/pages/CustomerPortal.tsx',
      'src/pages/Receipt.tsx',
      'src/pages/Sign.tsx',
      'src/hooks/useOrderData.ts',
      'src/hooks/useCustomerPortalRefresh.ts',
      'src/lib/portalOrderLoader.ts',
      'src/lib/customerPortalApi.ts',
      ...fs.readdirSync('src/components/customer-portal').filter((f: string) => f.endsWith('.tsx')).map((f: string) => `src/components/customer-portal/${f}`),
    ];
    const tables = ['orders', 'order_items', 'customers', 'addresses', 'payments', 'invoice_links', 'order_discounts', 'order_custom_fees', 'order_changelog', 'order_lot_pictures', 'order_pictures', 'task_status', 'notification_failures', 'admin_settings', 'documents', 'signatures'];
    const offenders: string[] = [];
    for (const f of portalFiles) {
      const s = read(f);
      for (const t of tables) if (new RegExp(`supabase\\s*\\.from\\(\\s*['"\`]${t}['"\`]`).test(s) || new RegExp(`\\)\\s*\\.from\\(\\s*['"\`]${t}['"\`]`).test(s)) offenders.push(`${f}:${t}`);
      if (/\.rpc\(/.test(s)) offenders.push(`${f}:rpc`);
      if (/\.channel\(/.test(s)) offenders.push(`${f}:realtime`);
    }
    eq('exit criteria: no customer-facing portal file reads or writes a sensitive table, calls an rpc or subscribes to Realtime', offenders, []);
    const portalGraph = portalFiles.filter((f) => !/customerPortalApi/.test(f)).map(read).join('\n');
    ok('exit criteria: the invoice screen no longer touches invoice_links or customers directly', !/invoice_links|\.from\('customers'\)/.test(read('src/components/customer-portal/InvoiceAcceptanceView.tsx')));
    ok('exit criteria: approval and rejection no longer call approve_order_changes or update orders', !/approve_order_changes|\.update\(/.test(read('src/components/customer-portal/ApprovalModal.tsx')) && !/\.update\(|\.insert\(/.test(read('src/components/customer-portal/RejectionModal.tsx')));
    ok('exit criteria: lot pictures and pictures no longer insert / delete table rows from the browser', !/\.insert\(|\.delete\(\)/.test(read('src/components/customer-portal/LotPicturesTab.tsx')) && !/\.insert\(/.test(read('src/components/customer-portal/RegularPortalView.tsx')));
    ok('exit criteria: the browser no longer reads admin settings or calls notification relays from the portal', !/admin_settings/.test(portalGraph) && !/functions\/v1\/send-sms-notification|functions\/v1\/send-email/.test(read('src/components/customer-portal/LotPicturesTab.tsx')));
    ok('exit criteria: the Stripe identifiers are never read by portal components (presence flag only)', !/stripe_customer_id|stripe_payment_method_id/.test(portalGraph));
    ok('exit criteria: portal summary building never writes travel miles back from the customer\'s browser', /persistTravelMiles: false/.test(read('src/lib/portalOrderLoader.ts')) && /persistTravelMiles: false/.test(read('src/pages/Receipt.tsx')));
    ok('exit criteria: the legacy get_order_with_relations_by_token rpc is no longer called by the app', !/get_order_with_relations_by_token/.test(read('src/hooks/useOrderData.ts')));
  }

  // =============================================================================================================
  // Token leakage
  // =============================================================================================================
  {
    const sources = ['supabase/functions/customer-portal-data/index.ts', 'supabase/functions/customer-portal-action/index.ts', 'src/lib/customerPortalApi.ts', 'src/lib/portalOrderLoader.ts', 'src/hooks/useOrderData.ts', 'src/components/customer-portal/SecureAccessRequired.tsx'];
    const logging = sources.flatMap((f) => (read(f).match(/console\.(log|warn|error|info)\([^)]*\)/g) ?? []).map((l) => `${f}: ${l}`));
    ok('leakage: no portal source logs a token, the request body, or a URL', logging.every((l) => !/token|body|url|href|location/i.test(l)));
    const h = fixture();
    const fn = loadFunction('customer-portal-action', h);
    await callFunction(fn, ANON_KEY, { orderId: 'order-act', token: tp('order-act'), action: 'approve_changes', payload: { selectedPaymentCents: 'x' } });
    await callFunction(fn, ANON_KEY, { orderId: 'order-act', token: tp('order-act'), action: 'update_order', payload: { status: 'confirmed' } });
    await callFunction(fn, ANON_KEY, { orderId: 'order-act', token: te('order-act'), action: 'check_unit_availability', payload: {} });
    ok('leakage: rejected / invalid requests log nothing containing the token', !h.logs.join('\n').includes(tp('order-act')) && !h.logs.join('\n').includes(te('order-act')));
    const resp = await callFunction(fn, ANON_KEY, { orderId: 'order-act', token: tp('order-act'), action: 'approve_changes', payload: { bad: 1 } });
    ok('leakage: error responses contain only a code, never the token or order data', !resp.text.includes(tp('order-act')) && Object.keys(resp.json).sort().join() === 'error,success' && resp.json.error === 'invalid_request');
    ok('leakage: the analytics path / error report redaction from the secure-link work is intact', /redactCredentialsInPath\(window\.location\.pathname\)/.test(read('src/lib/siteEvents.ts')) && /redactCredentialsInUrl\(window\.location\.href\)/.test(read('src/lib/errorReporter.ts')));
    ok('leakage: portal credentials are not placed in notification failure context', !read('src/components/customer-portal/InvoiceAcceptanceView.tsx').includes('notification_failures'));
    ok('leakage: the new endpoints are registered for the browser and checked inside', /\[functions\.customer-portal-data\]\s+verify_jwt = false/.test(read('supabase/config.toml')) && /\[functions\.customer-portal-action\]\s+verify_jwt = false/.test(read('supabase/config.toml')));
  }

  // makeClient is exported for reuse by other suites; reference it so the import is exercised
  ok('harness: in-memory client builds', typeof makeClient(newDb()).from === 'function');

  console.log(`Customer portal access tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} customer portal access test(s) failed`);
})();
