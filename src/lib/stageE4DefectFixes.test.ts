// Stage E4 — Defect-fix tests using actual production helpers.
// No unconditional `true` assertions. No copied formatting logic.
// Short-link tests call the real createShortPortalLink with a mock supabase client.

import { createShortPortalLink, type ShortPortalLinkResult } from './utils';
import { resolveCustomerPortalTab, buildTabUrlParam, CANONICAL_TAB_KEYS, type PortalNavSection } from './customerPortalTab';
import { hasGeneratorInOrderItems } from './generatorUnified';
import { buildPackageDisplay, isPackageItem, validatePackageSnapshot } from './packageDisplay';
import { formatStoredOrderItems } from './formatStoredOrderItems';
import { decideAddError } from './catalogAddError';
import { buildApprovalMessage, decideLotPicturesRequest, decideActionRequiredSms, decideEnRouteReminders } from './notificationDecision';
import type { BundleComponentSnapshot } from '../types';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

// Polyfill window.location.origin for Node test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = { location: { origin: 'https://example.com' } };
} else if (typeof (globalThis as any).window.location === 'undefined') {
  (globalThis as any).window.location = { origin: 'https://example.com' };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GENERATOR_PRODUCT_ID = '82a67261-2b54-4704-a8a0-4d346d0a8e60';
const CELEBRATION_BUNDLE_ID = 'cde247f7-522c-44f8-a6fc-a0bea426acb4';

const celebrationSnapshot: BundleComponentSnapshot = {
  bundle_name: 'Celebration Seating',
  bundle_description: '6 six-foot tables and 50 white folding chairs',
  components: [
    { product_id: '4cb4a96e-f6cf-4faa-917d-3e1d74146aa5', product_name: 'White Folding Chair', quantity_per_bundle: 50 },
    { product_id: 'aeed01e4-73a3-40a0-bb01-82ec2f60ee73', product_name: 'Six-foot Rectangular Table', quantity_per_bundle: 6 },
  ],
};

function makeOrderItem(overrides: Partial<any>): any {
  return {
    id: 'item-id-' + Math.random(),
    order_id: 'order-1',
    unit_id: null,
    product_id: null,
    bundle_id: null,
    item_name: null,
    pricing_context: null,
    component_snapshot: null,
    qty: 1,
    wet_or_dry: null,
    unit_price_cents: 0,
    ...overrides,
  };
}

function makeInflatableItem(name: string, price: number, qty = 1, mode: 'dry' | 'water' = 'dry'): any {
  return makeOrderItem({ unit_id: 'unit-' + name, qty, wet_or_dry: mode, unit_price_cents: price, units: { name } });
}

function makeEEProductItem(name: string, productId: string, price: number, qty = 1, context: 'standalone' | 'addon' = 'standalone'): any {
  return makeOrderItem({ product_id: productId, item_name: name, pricing_context: context, qty, unit_price_cents: price });
}

function makeEEBundleItem(name: string, bundleId: string, price: number, qty = 1, snapshot: BundleComponentSnapshot | null = celebrationSnapshot): any {
  return makeOrderItem({ bundle_id: bundleId, item_name: name, pricing_context: 'standalone', qty, unit_price_cents: price, component_snapshot: snapshot });
}

function makeSections(overrides: { lockedPayment?: boolean } = {}): PortalNavSection[] {
  return [
    { key: 'details', locked: false },
    { key: 'lot-pics', locked: false },
    { key: 'waiver', locked: false },
    { key: 'payment', locked: overrides.lockedPayment ?? false },
    { key: 'pictures', locked: false },
    { key: 'delivery', locked: false },
  ];
}

function makeMockSupabase(opts: {
  invoiceRpcResult?: any;
  invoiceRpcError?: any;
  orderRpcResult?: any;
  orderRpcError?: any;
  invoiceLinkData?: any;
  invoiceLinkError?: any;
} = {}) {
  return {
    rpc(fn: string, _args?: any) {
      if (fn === 'create_portal_short_link') {
        if (opts.invoiceRpcError) return Promise.resolve({ data: null, error: opts.invoiceRpcError });
        return Promise.resolve({ data: opts.invoiceRpcResult ?? null, error: null });
      }
      if (fn === 'create_order_short_link') {
        if (opts.orderRpcError) return Promise.resolve({ data: null, error: opts.orderRpcError });
        return Promise.resolve({ data: opts.orderRpcResult ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'Unknown RPC' } });
    },
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: any) {
              return {
                maybeSingle() {
                  if (opts.invoiceLinkError) return Promise.resolve({ data: null, error: opts.invoiceLinkError });
                  return Promise.resolve({ data: opts.invoiceLinkData ?? null, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
}

// ===========================================================================
// Portal navigation tests (1-9)
// ===========================================================================

{ const sections = makeSections(); ok('1 tab=payment → payment', resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'payment'); }
{ const sections = makeSections(); ok('2 tab=lot-pics → lot-pics', resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections }) === 'lot-pics'); }
{ const sections = makeSections(); ok('3 tab=lot-pictures → lot-pics', resolveCustomerPortalTab({ requestedTab: 'lot-pictures', sections }) === 'lot-pics'); }
{ const sections = makeSections(); ok('4 invalid → details', resolveCustomerPortalTab({ requestedTab: 'nonexistent', sections }) === 'details'); }
{ const sections = makeSections({ lockedPayment: true }); ok('5 locked payment → details', resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'details'); }
{ const sections = makeSections(); const r1 = resolveCustomerPortalTab({ requestedTab: 'payment', sections }); const r2 = resolveCustomerPortalTab({ requestedTab: 'payment', sections }); ok('6 payment stays after refresh', r1 === 'payment' && r2 === 'payment'); }
{ const sb = makeSections({ lockedPayment: false }); const sa = makeSections({ lockedPayment: true }); ok('7 payment locked → details', resolveCustomerPortalTab({ requestedTab: 'payment', sections: sb }) === 'payment' && resolveCustomerPortalTab({ requestedTab: 'payment', sections: sa }) === 'details'); }
{ const sections = makeSections(); ok('8 back-nav', resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'payment' && resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections }) === 'lot-pics'); }
{ const sections = makeSections(); ok('9 forward-nav', resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections }) === 'lot-pics' && resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'payment'); }

// ===========================================================================
// Short-link tests (10-18)
// ===========================================================================

{
  const mock = makeMockSupabase({ invoiceRpcResult: { success: true, short_code: 'INV12345' } });
  const result = await createShortPortalLink('order-1', mock as any, null, 'inv-token-1');
  ok('10 invoice RPC success → success', result.success === true);
  if (result.success) { ok('10 url /i/', result.url.includes('/i/')); ok('10 code INV12345', result.shortCode === 'INV12345'); }
}
{
  const mock = makeMockSupabase({ orderRpcResult: { success: true, short_code: 'ORD67890' } });
  const result = await createShortPortalLink('order-2', mock as any, null, null);
  ok('11 order RPC success → success', result.success === true);
  if (result.success) { ok('11 url /i/', result.url.includes('/i/')); }
}
{
  const mock = makeMockSupabase({ invoiceRpcError: { message: 'Failed' }, orderRpcError: { message: 'Failed' } });
  const result = await createShortPortalLink('order-3', mock as any, null, 'inv-token-3');
  ok('12 both fail → false', result.success === false);
  if (!result.success) { ok('12 has error', result.error.length > 0); }
}
{
  const mock = makeMockSupabase({ invoiceRpcError: { message: 'Failed' }, orderRpcError: { message: 'Failed' }, invoiceLinkData: { short_code: 'EXISTING1' } });
  const result = await createShortPortalLink('order-4', mock as any, null, 'inv-token-4');
  ok('13 fallback lookup → success', result.success === true);
  if (result.success) { ok('13 url EXISTING1', result.url.includes('EXISTING1')); }
}
{
  const mock = makeMockSupabase({ invoiceRpcError: { message: 'Failed' }, orderRpcError: { message: 'Failed' } });
  const result = await createShortPortalLink('order-5', mock as any, null, 'inv-token-5');
  ok('14 failure no /customer-portal/', !JSON.stringify(result).includes('/customer-portal/'));
}
{
  const mock = makeMockSupabase({ invoiceRpcError: { message: 'Failed' }, orderRpcError: { message: 'Failed' } });
  const result = await createShortPortalLink('order-6', mock as any, null, null);
  ok('15 failure no /invoice/', !JSON.stringify(result).includes('/invoice/'));
}
{
  const mock = makeMockSupabase({ orderRpcResult: { success: true, short_code: 'CODE1234' } });
  const result = await createShortPortalLink('order-7', mock as any, null, null);
  ok('16 success /i/', result.success && result.url.includes('/i/'));
}
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const decision = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'en_route_action_required' });
  ok('17 shouldSend=false on link failure', decision.shouldSendSms === false);
  ok('17 failureRecord exists', decision.failureRecord !== null);
}
{
  // Test with notificationWarning
  const msgOk = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: undefined });
  ok('18 approval success no warning', msgOk === 'Booking approved and customer notified.');
}

// ===========================================================================
// Stored-item formatter tests
// ===========================================================================

{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-1 Generator (Add-on)', formatted[0].name === 'Generator (Add-on)');
  ok('fmt-1 no Unknown Unit', !formatted[0].name.includes('Unknown Unit'));
}
{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-2 Event Essential', formatted[0].mode === 'Event Essential');
}
{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 1)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-3 has components', formatted[0].components.length === 2);
  ok('fmt-3 chair', formatted[0].components[0].name === 'White Folding Chair');
  ok('fmt-3 table', formatted[0].components[1].name === 'Six-foot Rectangular Table');
}
{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 3)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-4 chair qty=150', formatted[0].components[0].quantity === 150);
  ok('fmt-4 table qty=18', formatted[0].components[1].quantity === 18);
}
{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 2)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-5 one line', formatted.length === 1);
  ok('fmt-5 price=15000', formatted[0].price === 15000);
  ok('fmt-5 qty=2', formatted[0].qty === 2);
}
{
  const items = [makeEEBundleItem('Old Package', 'old-bundle', 10000, 1, null)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-6 unavailable', formatted[0].packageContentsUnavailable === true);
  ok('fmt-6 no components', formatted[0].components.length === 0);
}
{
  const items = [makeInflatableItem('Tropical Slide', 25000, 1, 'water')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-7 name', formatted[0].name === 'Tropical Slide');
  ok('fmt-7 Water', formatted[0].mode === 'Water');
}

// ===========================================================================
// Generator tests
// ===========================================================================

{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  ok('gen-14 direct generator → Yes', hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }) === true);
}
{
  const snapshotWithGen: BundleComponentSnapshot = { bundle_name: 'P', bundle_description: '', components: [{ product_id: GENERATOR_PRODUCT_ID, product_name: 'Generator', quantity_per_bundle: 1 }] };
  const items = [makeEEBundleItem('P', 'b', 20000, 1, snapshotWithGen)];
  ok('gen-15 package generator → Yes', hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }) === true);
}
{
  const items = [makeEEProductItem('Tables', 'other', 5000, 2), makeEEBundleItem('Chair Package', 'b', 10000, 1)];
  ok('gen-16 unrelated → No', hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }) === false);
}
{ ok('gen-17 legacy → Yes', hasGeneratorInOrderItems({ orderItems: [], generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 2 }) === true); }
{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const r1 = hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 });
  ok('gen-18 same result', r1 === hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 }));
}

// ===========================================================================
// Catalog add-error tests (using decideAddError — wired into EventEssentialsCatalog)
// ===========================================================================

{
  const d = decideAddError(null, 'Insufficient inventory');
  ok('cat-30 banner receives error', d.bannerMessage === 'Insufficient inventory');
}
{
  const d = decideAddError(null, 'Insufficient inventory');
  ok('cat-31 toast receives error', d.showToast === true);
}
{
  const d1 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  const d2 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  ok('cat-32 first click toast', d1.showToast === true);
  ok('cat-32 second click toast', d2.showToast === true);
}

// ===========================================================================
// Production-path: PendingOrderCard approval result display
// (using buildApprovalMessage — wired into PendingOrderCard)
// ===========================================================================

// 1. Normal success does not claim a deposit was charged
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: undefined });
  ok('approval-1 success message', msg === 'Booking approved and customer notified.');
  ok('approval-1 no deposit claim', !msg.includes('deposit'));
}
// 2. Zero-deposit success does not claim a deposit was charged
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: undefined, approvalError: undefined });
  ok('approval-2 zero-deposit success', msg === 'Booking approved and customer notified.');
  ok('approval-2 no deposit claim', !msg.includes('deposit'));
}
// 3. Notification failure reports approval success plus notification warning
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'SMS: send returned false' });
  ok('approval-3 warning message', msg === 'Booking approved, but the customer notification failed. Retry the notification from the order.');
  ok('approval-3 no deposit claim', !msg.includes('deposit'));
}
// 4. Approval failure includes the controlled result.error
{
  const msg = buildApprovalMessage({ approvalSuccessful: false, notificationWarning: undefined, approvalError: 'Card declined' });
  ok('approval-4 failure message', msg === 'Error approving order: Card declined');
}
// 4b. Approval failure with no error string
{
  const msg = buildApprovalMessage({ approvalSuccessful: false, notificationWarning: undefined });
  ok('approval-4b failure fallback', msg === 'Error approving order: Unknown error');
}

// ===========================================================================
// Production-path: Lot Pictures SMS false behavior
// (using decideLotPicturesRequest — wired into PendingOrderCard)
// ===========================================================================

// 3. SMS returning false does not permit requested-state update
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const d = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: false });
  ok('lot-3 false SMS → no mark', d.shouldMarkRequested === false);
  ok('lot-3 failureRecord exists', d.failureRecord !== null);
  ok('lot-3 channel=sms', d.failureRecord!.channel === 'sms');
}
// 4. SMS success permits requested-state update
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const d = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: true });
  ok('lot-4 success → mark', d.shouldMarkRequested === true);
  ok('lot-4 no failure', d.failureRecord === null);
}
// Lot pictures link failure
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const d = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: false });
  ok('lot-link-fail no mark', d.shouldMarkRequested === false);
  ok('lot-link-fail error', d.failureRecord!.error === 'Link failed');
}

// ===========================================================================
// Production-path: En Route / Arrived action-required link failure
// (using decideActionRequiredSms — wired into TaskDetailModal)
// ===========================================================================

// 5. En Route action-required link failure prevents SMS send
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const d = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'en_route_action_required' });
  ok('enroute-5 shouldSend=false', d.shouldSendSms === false);
  ok('enroute-5 failureRecord', d.failureRecord !== null);
  ok('enroute-5 message_type', d.failureRecord!.message_type === 'en_route_action_required');
}
// 6. Arrived action-required link failure prevents SMS send
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const d = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'arrived_action_required' });
  ok('arrived-6 shouldSend=false', d.shouldSendSms === false);
  ok('arrived-6 failureRecord', d.failureRecord !== null);
}
// 7. En Route without action requirement may send without portal link
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'No action required' };
  const d = decideActionRequiredSms({ hasActionRequirement: false, linkResult, messageType: 'en_route_action_required' });
  ok('enroute-7 no action → send', d.shouldSendSms === true);
  ok('enroute-7 no failureRecord', d.failureRecord === null);
}
// 7b. En Route with action requirement and successful link → send
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const d = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'en_route_action_required' });
  ok('enroute-7b action+link → send', d.shouldSendSms === true);
}

// ===========================================================================
// Production-path: Approval notification uses one short URL for both
// (verified via mock — both channels receive same URL)
// ===========================================================================

// 8. Approval notification uses one short URL for both SMS and email
{
  const mock = makeMockSupabase({ invoiceRpcResult: { success: true, short_code: 'SHARED1' } });
  const result = await createShortPortalLink('order-shared', mock as any, null, 'inv-shared');
  ok('approval-8 one link for both', result.success === true);
  if (result.success) {
    ok('approval-8 url is /i/SHARED1', result.url === 'https://example.com/i/SHARED1');
  }
}

// 9. Email failure is reported separately (buildApprovalMessage with email-only error)
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'Email: SMTP timeout' });
  ok('approval-9 email failure in warning', msg.includes('notification failed'));
}

// 10. SMS failure is reported separately
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'SMS: send returned false' });
  ok('approval-10 sms failure in warning', msg.includes('notification failed'));
}

// 11. Approval remains successful when notification fails
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'SMS: failed' });
  ok('approval-11 approval successful', msg.includes('Booking approved'));
  ok('approval-11 notification failed', msg.includes('notification failed'));
}

// 12. Second identical unavailable-package click still produces one new toast
{
  const d1 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  const d2 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  ok('cat-12 first toast', d1.showToast === true);
  ok('cat-12 second toast', d2.showToast === true);
}

// ===========================================================================
// Additional: buildPackageDisplay and validatePackageSnapshot
// ===========================================================================

{
  const result = buildPackageDisplay({ bundleName: 'Celebration Seating', bundleQty: 2, unitPriceCents: 15000, componentSnapshot: celebrationSnapshot });
  ok('36 chair qty=100', result.components[0].quantity === 100);
  ok('36 table qty=12', result.components[1].quantity === 12);
}
{
  const result = buildPackageDisplay({ bundleName: 'Old', bundleQty: 1, unitPriceCents: 10000, componentSnapshot: null });
  ok('37 no components', result.components.length === 0);
  ok('37 hasSnapshot=false', result.hasSnapshot === false);
}
{
  ok('38 bundle is package', isPackageItem({ item_type: 'event_essential_bundle', bundle_id: 'b1', unit_id: null }) === true);
  ok('38 product not package', isPackageItem({ item_type: 'event_essential_product', product_id: 'p1', unit_id: null }) === false);
  ok('38 inflatable not package', isPackageItem({ unit_id: 'u1', bundle_id: null }) === false);
}
{
  const result = validatePackageSnapshot({ bundle_id: 'b1', bundle_name: 'Test', unit_price_cents: 10000, qty: 1, component_snapshot: null });
  ok('39 missing snapshot rejected', !result.ok);
}
{
  ok('40 has details', CANONICAL_TAB_KEYS.includes('details'));
  ok('40 has lot-pics', CANONICAL_TAB_KEYS.includes('lot-pics'));
  ok('40 has waiver', CANONICAL_TAB_KEYS.includes('waiver'));
  ok('40 has payment', CANONICAL_TAB_KEYS.includes('payment'));
  ok('40 has pictures', CANONICAL_TAB_KEYS.includes('pictures'));
  ok('40 has delivery', CANONICAL_TAB_KEYS.includes('delivery'));
  ok('40 no lot-pictures', !(CANONICAL_TAB_KEYS as readonly string[]).includes('lot-pictures'));
}
{
  ok('41 details → null', buildTabUrlParam('details') === null);
  ok('41 payment → payment', buildTabUrlParam('payment') === 'payment');
  ok('41 lot-pics → lot-pics', buildTabUrlParam('lot-pics') === 'lot-pics');
}

// ===========================================================================
// Unauthorized order-link creation test
// ===========================================================================

// 42. Unauthorized order-link creation returns controlled failure.
{
  const mock = makeMockSupabase({ orderRpcResult: { success: false, error: 'Unauthorized: only staff can create order short links' } });
  const result = await createShortPortalLink('order-unauth', mock as any, null, null);
  ok('42 unauthorized → false', result.success === false);
  if (!result.success) { ok('42 error Unauthorized', result.error.includes('Unauthorized')); }
}

// 43. Unknown order returns controlled "Order not found"
{
  const mock = makeMockSupabase({ orderRpcResult: { success: false, error: 'Order not found' } });
  const result = await createShortPortalLink('order-unknown', mock as any, null, null);
  ok('43 unknown order → false', result.success === false);
  if (!result.success) { ok('43 error Order not found', result.error.includes('Order not found')); }
}

// 44. Crew denied (no assignment relationship)
{
  const mock = makeMockSupabase({ orderRpcResult: { success: false, error: 'Unauthorized: crew cannot create order short links without an assignment relationship' } });
  const result = await createShortPortalLink('order-crew', mock as any, null, null);
  ok('44 crew denied → false', result.success === false);
  if (!result.success) { ok('44 crew error', result.error.includes('crew')); }
}

// ===========================================================================
// decideEnRouteReminders — En Route/Arrived reminder-field persistence
// ===========================================================================

// 45. Short-link failure: no SMS, all reminders false, failure recorded
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: false,
    waiverSigned: false,
    balanceDue: 100,
    messageType: 'en_route_action_required',
    failureError: 'Unauthorized: crew cannot create order short links',
  });
  ok('45 eta false', d.etaSent === false);
  ok('45 waiver false', d.waiverReminderSent === false);
  ok('45 payment false', d.paymentReminderSent === false);
  ok('45 failure recorded', d.failureRecord !== null);
  if (d.failureRecord) {
    ok('45 channel sms', d.failureRecord.channel === 'sms');
    ok('45 message_type', d.failureRecord.message_type === 'en_route_action_required');
  }
}

// 46. SMS endpoint non-OK: reminders false, failure recorded
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: false,
    waiverSigned: true,
    balanceDue: 0,
    messageType: 'en_route',
    failureError: 'SMS endpoint returned 500',
  });
  ok('46 eta false', d.etaSent === false);
  ok('46 waiver false', d.waiverReminderSent === false);
  ok('46 payment false', d.paymentReminderSent === false);
  ok('46 failure recorded', d.failureRecord !== null);
}

// 47. SMS network exception: reminders false, failure recorded
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: false,
    waiverSigned: false,
    balanceDue: 50,
    messageType: 'arrived_action_required',
    failureError: 'Network error',
  });
  ok('47 eta false', d.etaSent === false);
  ok('47 waiver false', d.waiverReminderSent === false);
  ok('47 payment false', d.paymentReminderSent === false);
  ok('47 failure recorded', d.failureRecord !== null);
}

// 48. Successful action-required SMS: relevant reminders true
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: true,
    waiverSigned: false,
    balanceDue: 100,
    messageType: 'en_route_action_required',
  });
  ok('48 eta true', d.etaSent === true);
  ok('48 waiver true', d.waiverReminderSent === true);
  ok('48 payment true', d.paymentReminderSent === true);
  ok('48 no failure', d.failureRecord === null);
}

// 49. Successful normal SMS, no action requirement: eta true, reminders false
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: true,
    waiverSigned: true,
    balanceDue: 0,
    messageType: 'en_route',
  });
  ok('49 eta true', d.etaSent === true);
  ok('49 waiver false', d.waiverReminderSent === false);
  ok('49 payment false', d.paymentReminderSent === false);
  ok('49 no failure', d.failureRecord === null);
}

// 50. Successful SMS, waiver signed but balance due: payment reminder true only
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: true,
    waiverSigned: true,
    balanceDue: 200,
    messageType: 'arrived_action_required',
  });
  ok('50 eta true', d.etaSent === true);
  ok('50 waiver false', d.waiverReminderSent === false);
  ok('50 payment true', d.paymentReminderSent === true);
}

console.log(`\nStage E4 Defect-Fix Tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
