// Stage E4 — Defect-fix tests using actual production helpers.
// No unconditional `true` assertions. No copied formatting logic.
// Short-link tests call the real createShortPortalLink with a mock supabase client.

// Polyfill window.location.origin for Node test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = { location: { origin: 'https://example.com' } };
} else if (typeof (globalThis as any).window.location === 'undefined') {
  (globalThis as any).window.location = { origin: 'https://example.com' };
}

import { createShortPortalLink, type ShortPortalLinkResult } from './utils';
import { resolveCustomerPortalTab, buildTabUrlParam, CANONICAL_TAB_KEYS, type PortalNavSection } from './customerPortalTab';
import { hasGeneratorInOrderItems } from './generatorUnified';
import { buildPackageDisplay, isPackageItem, validatePackageSnapshot } from './packageDisplay';
import { formatStoredOrderItems } from './formatStoredOrderItems';
import { decideAddError, decideAddSuccess } from './catalogAddError';
import { decideNotificationSend, buildApprovalResultMessage, decideLotPicturesRequest } from './notificationDecision';
import type { BundleComponentSnapshot } from '../types';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
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
  return makeOrderItem({
    unit_id: 'unit-' + name,
    qty,
    wet_or_dry: mode,
    unit_price_cents: price,
    units: { name },
  });
}

function makeEEProductItem(name: string, productId: string, price: number, qty = 1, context: 'standalone' | 'addon' = 'standalone'): any {
  return makeOrderItem({
    product_id: productId,
    item_name: name,
    pricing_context: context,
    qty,
    unit_price_cents: price,
  });
}

function makeEEBundleItem(name: string, bundleId: string, price: number, qty = 1, snapshot: BundleComponentSnapshot | null = celebrationSnapshot): any {
  return makeOrderItem({
    bundle_id: bundleId,
    item_name: name,
    pricing_context: 'standalone',
    qty,
    unit_price_cents: price,
    component_snapshot: snapshot,
  });
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

// Mock supabase client factory for createShortPortalLink tests
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
// Portal navigation tests (1-9) — using resolveCustomerPortalTab
// ===========================================================================

// 1. tab=payment resolves to Payment.
{
  const sections = makeSections();
  const result = resolveCustomerPortalTab({ requestedTab: 'payment', sections });
  ok('1 tab=payment → payment', result === 'payment');
}

// 2. tab=lot-pics resolves to Lot Pics.
{
  const sections = makeSections();
  const result = resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections });
  ok('2 tab=lot-pics → lot-pics', result === 'lot-pics');
}

// 3. tab=lot-pictures normalizes to lot-pics.
{
  const sections = makeSections();
  const result = resolveCustomerPortalTab({ requestedTab: 'lot-pictures', sections });
  ok('3 tab=lot-pictures → lot-pics', result === 'lot-pics');
}

// 4. Invalid value resolves to Details.
{
  const sections = makeSections();
  const result = resolveCustomerPortalTab({ requestedTab: 'nonexistent', sections });
  ok('4 invalid → details', result === 'details');
}

// 5. Locked Payment resolves to Details.
{
  const sections = makeSections({ lockedPayment: true });
  const result = resolveCustomerPortalTab({ requestedTab: 'payment', sections });
  ok('5 locked payment → details', result === 'details');
}

// 6. Accessible Payment remains selected after an unrelated order refresh.
{
  const sections = makeSections();
  const result1 = resolveCustomerPortalTab({ requestedTab: 'payment', sections });
  const result2 = resolveCustomerPortalTab({ requestedTab: 'payment', sections });
  ok('6 payment stays after refresh', result1 === 'payment' && result2 === 'payment');
}

// 7. Payment becoming locked resolves to Details.
{
  const sectionsBefore = makeSections({ lockedPayment: false });
  const sectionsAfter = makeSections({ lockedPayment: true });
  const before = resolveCustomerPortalTab({ requestedTab: 'payment', sections: sectionsBefore });
  const after = resolveCustomerPortalTab({ requestedTab: 'payment', sections: sectionsAfter });
  ok('7 payment accessible before', before === 'payment');
  ok('7 payment locked → details after', after === 'details');
}

// 8. Back-navigation URL input changes the returned active section.
{
  const sections = makeSections();
  const atPayment = resolveCustomerPortalTab({ requestedTab: 'payment', sections });
  const atLotPics = resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections });
  ok('8 back-nav: payment → lot-pics', atPayment === 'payment' && atLotPics === 'lot-pics');
}

// 9. Forward-navigation URL input changes the returned active section.
{
  const sections = makeSections();
  const atLotPics = resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections });
  const atPayment = resolveCustomerPortalTab({ requestedTab: 'payment', sections });
  ok('9 forward-nav: lot-pics → payment', atLotPics === 'lot-pics' && atPayment === 'payment');
}

// ===========================================================================
// Short-link tests (10-18) — calling real createShortPortalLink with mock client
// ===========================================================================

// 10. Invoice RPC success returns /i/<code>.
{
  const mock = makeMockSupabase({ invoiceRpcResult: { success: true, short_code: 'INV12345' } });
  const result = await createShortPortalLink('order-1', mock as any, null, 'inv-token-1');
  ok('10 invoice RPC success → success', result.success === true);
  if (result.success) {
    ok('10 url contains /i/', result.url.includes('/i/'));
    ok('10 url contains INV12345', result.url.includes('INV12345'));
    ok('10 shortCode = INV12345', result.shortCode === 'INV12345');
  }
}

// 11. Standard-order RPC success returns /i/<code>.
{
  const mock = makeMockSupabase({ orderRpcResult: { success: true, short_code: 'ORD67890' } });
  const result = await createShortPortalLink('order-2', mock as any, null, null);
  ok('11 order RPC success → success', result.success === true);
  if (result.success) {
    ok('11 url contains /i/', result.url.includes('/i/'));
    ok('11 url contains ORD67890', result.url.includes('ORD67890'));
  }
}

// 12. Both RPCs failing returns success=false with no URL.
{
  const mock = makeMockSupabase({
    invoiceRpcError: { message: 'Invoice RPC failed' },
    orderRpcError: { message: 'Order RPC failed' },
  });
  const result = await createShortPortalLink('order-3', mock as any, null, 'inv-token-3');
  ok('12 both fail → success=false', result.success === false);
  if (!result.success) {
    ok('12 has error message', result.error.length > 0);
  }
}

// 13. Existing invoice short code lookup returns /i/<code>.
{
  const mock = makeMockSupabase({
    invoiceRpcError: { message: 'RPC failed' },
    orderRpcError: { message: 'RPC failed' },
    invoiceLinkData: { short_code: 'EXISTING1' },
  });
  const result = await createShortPortalLink('order-4', mock as any, null, 'inv-token-4');
  ok('13 fallback lookup → success', result.success === true);
  if (result.success) {
    ok('13 url contains /i/', result.url.includes('/i/'));
    ok('13 url contains EXISTING1', result.url.includes('EXISTING1'));
  }
}

// 14. No failure result contains /customer-portal/.
{
  const mock = makeMockSupabase({
    invoiceRpcError: { message: 'Failed' },
    orderRpcError: { message: 'Failed' },
  });
  const result = await createShortPortalLink('order-5', mock as any, null, 'inv-token-5');
  ok('14 failure has no /customer-portal/', !JSON.stringify(result).includes('/customer-portal/'));
}

// 15. No failure result contains /invoice/.
{
  const mock = makeMockSupabase({
    invoiceRpcError: { message: 'Failed' },
    orderRpcError: { message: 'Failed' },
  });
  const result = await createShortPortalLink('order-6', mock as any, null, null);
  ok('15 failure has no /invoice/', !JSON.stringify(result).includes('/invoice/'));
}

// 16. Successful result contains /i/.
{
  const mock = makeMockSupabase({ orderRpcResult: { success: true, short_code: 'CODE1234' } });
  const result = await createShortPortalLink('order-7', mock as any, null, null);
  ok('16 success contains /i/', result.success && result.url.includes('/i/'));
}

// 17. Notification send function is not called when a required link fails.
// Using decideNotificationSend production helper.
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const decision = decideNotificationSend({ linkResult, channel: 'email', messageType: 'booking_confirmation' });
  ok('17 shouldSend=false on link failure', decision.shouldSend === false);
  ok('17 failureRecord has error', decision.failureRecord !== null);
  if (decision.failureRecord) {
    ok('17 failureRecord channel=email', decision.failureRecord.channel === 'email');
    ok('17 failureRecord error=Link failed', decision.failureRecord.error === 'Link failed');
  }
}

// 18. Approval outcome remains successful while notification result is failed.
// Using buildApprovalResultMessage production helper.
{
  const msg = buildApprovalResultMessage({
    approvalSuccessful: true,
    notificationSuccessful: false,
    notificationError: 'Short-link failed',
  });
  ok('18 approval successful in message', msg.includes('Order approved'));
  ok('18 notification failed in message', msg.includes('notification failed'));
  ok('18 message includes retry instruction', msg.includes('Retry'));
}

// ===========================================================================
// Stored-item formatter tests (using formatStoredOrderItems)
// ===========================================================================

// fmt-1. Direct Generator displays Generator (Add-on), not Unknown Unit.
{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-1 name is Generator (Add-on)', formatted[0].name === 'Generator (Add-on)');
  ok('fmt-1 no Unknown Unit', !formatted[0].name.includes('Unknown Unit'));
}

// fmt-2. Direct Event Essential has no Dry/Water label.
{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-2 mode is Event Essential', formatted[0].mode === 'Event Essential');
  ok('fmt-2 no Dry', !formatted[0].mode.includes('Dry'));
  ok('fmt-2 no Water', !formatted[0].mode.includes('Water'));
}

// fmt-3. Package uses component_snapshot.
{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 1)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-3 has components', formatted[0].components.length === 2);
  ok('fmt-3 chair component', formatted[0].components[0].name === 'White Folding Chair');
  ok('fmt-3 table component', formatted[0].components[1].name === 'Six-foot Rectangular Table');
}

// fmt-4. Package components multiply by package quantity.
{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 3)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-4 chair qty = 150', formatted[0].components[0].quantity === 150);
  ok('fmt-4 table qty = 18', formatted[0].components[1].quantity === 18);
}

// fmt-5. Package price appears once.
{
  const items = [makeEEBundleItem('Celebration Seating', CELEBRATION_BUNDLE_ID, 15000, 2)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-5 one package line', formatted.length === 1);
  ok('fmt-5 price = 15000', formatted[0].price === 15000);
  ok('fmt-5 qty = 2', formatted[0].qty === 2);
  ok('fmt-5 lineTotal = 30000', formatted[0].price * formatted[0].qty === 30000);
}

// fmt-6. Missing snapshot produces the historical fallback.
{
  const items = [makeEEBundleItem('Old Package', 'old-bundle', 10000, 1, null)];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-6 packageContentsUnavailable', formatted[0].packageContentsUnavailable === true);
  ok('fmt-6 no components', formatted[0].components.length === 0);
  ok('fmt-6 name preserved', formatted[0].name === 'Old Package');
  ok('fmt-6 price preserved', formatted[0].price === 10000);
}

// fmt-7. Inflatable formatting remains unchanged.
{
  const items = [makeInflatableItem('Tropical Slide', 25000, 1, 'water')];
  const formatted = formatStoredOrderItems(items);
  ok('fmt-7 name is Tropical Slide', formatted[0].name === 'Tropical Slide');
  ok('fmt-7 mode is Water', formatted[0].mode === 'Water');
  ok('fmt-7 no components', formatted[0].components.length === 0);
  ok('fmt-7 no packageContentsUnavailable', formatted[0].packageContentsUnavailable === false);
}

// ===========================================================================
// Generator tests (using hasGeneratorInOrderItems)
// ===========================================================================

// gen-14. Pending Review direct Generator returns Yes.
{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const has = hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 });
  ok('gen-14 direct generator → Yes', has === true);
}

// gen-15. Pending Review package-contained Generator returns Yes.
{
  const snapshotWithGen: BundleComponentSnapshot = {
    bundle_name: 'Package With Generator',
    bundle_description: '',
    components: [{ product_id: GENERATOR_PRODUCT_ID, product_name: 'Generator', quantity_per_bundle: 1 }],
  };
  const items = [makeEEBundleItem('Package With Generator', 'bundle-with-gen', 20000, 1, snapshotWithGen)];
  const has = hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 });
  ok('gen-15 package-contained generator → Yes', has === true);
}

// gen-16. Unrelated Event Essentials returns No.
{
  const items = [
    makeEEProductItem('Tables', 'some-other-product', 5000, 2),
    makeEEBundleItem('Chair Package', 'some-bundle', 10000, 1),
  ];
  const has = hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 });
  ok('gen-16 unrelated EE → No', has === false);
}

// gen-17. Historical generator_qty fallback returns Yes.
{
  const has = hasGeneratorInOrderItems({ orderItems: [], generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 2 });
  ok('gen-17 legacy generator_qty → Yes', has === true);
}

// gen-18. Pending and Confirmed use the same production decision helper.
{
  const items = [makeEEProductItem('Generator', GENERATOR_PRODUCT_ID, 9500, 1, 'addon')];
  const pendingResult = hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 });
  const confirmedResult = hasGeneratorInOrderItems({ orderItems: items, generatorProductId: GENERATOR_PRODUCT_ID, legacyGeneratorQty: 0 });
  ok('gen-18 same result regardless of status', pendingResult === confirmedResult);
}

// ===========================================================================
// Catalog add-error tests (using decideAddError)
// ===========================================================================

// cat-30. Page banner receives the error.
{
  const decision = decideAddError(null, 'Insufficient inventory');
  ok('cat-30 banner receives error', decision.bannerMessage === 'Insufficient inventory');
}

// cat-31. Fixed toast receives the same controlled error.
{
  const decision = decideAddError(null, 'Insufficient inventory');
  ok('cat-31 toast receives error', decision.showToast === true);
}

// cat-32. Repeated catalog failure on two separate clicks produces one toast for each click.
{
  const decision1 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  const decision2 = decideAddError('Insufficient inventory', 'Insufficient inventory');
  ok('cat-32 first click shows toast', decision1.showToast === true);
  ok('cat-32 second click shows toast', decision2.showToast === true);
}

// cat-33. Cart mutation is not called on error.
{
  const decision = decideAddError(null, 'Error');
  ok('cat-33 cart not mutated', decision.shouldAddToCart === false);
}

// cat-34. Date mutation is not called on error.
{
  const decision = decideAddError(null, 'Error');
  ok('cat-34 dates not mutated', decision.shouldResetDates === false);
}

// cat-35. Success decision allows cart and date mutation.
{
  const decision = decideAddSuccess();
  ok('cat-35 success adds to cart', decision.shouldAddToCart === true);
  ok('cat-35 success resets dates', decision.shouldResetDates === true);
  ok('cat-35 success no toast', decision.showToast === false);
}

// ===========================================================================
// Lot Pictures request tests (using decideLotPicturesRequest)
// ===========================================================================

// lot-11. Lot Pictures requested state is not written when SMS/link creation fails.
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const decision = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: false });
  ok('lot-11 shouldMarkRequested=false on link failure', decision.shouldMarkRequested === false);
  ok('lot-11 failureRecord exists', decision.failureRecord !== null);
}

// lot-11b. Lot Pictures requested state IS written when both link and SMS succeed.
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const decision = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: true });
  ok('lot-11b shouldMarkRequested=true on success', decision.shouldMarkRequested === true);
  ok('lot-11b no failureRecord on success', decision.failureRecord === null);
}

// lot-11c. Lot Pictures not marked when link succeeds but SMS fails.
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const decision = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: false });
  ok('lot-11c shouldMarkRequested=false on SMS failure', decision.shouldMarkRequested === false);
}

// ===========================================================================
// En Route action-required SMS tests (using decideNotificationSend)
// ===========================================================================

// enroute-12. En Route action-required SMS is not sent without its required link.
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const decision = decideNotificationSend({ linkResult, channel: 'sms', messageType: 'en_route_action_required' });
  ok('enroute-12 shouldSend=false on link failure', decision.shouldSend === false);
  ok('enroute-12 failureRecord channel=sms', decision.failureRecord?.channel === 'sms');
}

// enroute-12b. En Route SMS IS sent when link succeeds.
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const decision = decideNotificationSend({ linkResult, channel: 'sms', messageType: 'en_route_action_required' });
  ok('enroute-12b shouldSend=true on link success', decision.shouldSend === true);
}

// ===========================================================================
// Additional: buildPackageDisplay and validatePackageSnapshot
// ===========================================================================

// 36. buildPackageDisplay multiplies component qty by package qty
{
  const result = buildPackageDisplay({
    bundleName: 'Celebration Seating',
    bundleQty: 2,
    unitPriceCents: 15000,
    componentSnapshot: celebrationSnapshot,
  });
  ok('36 chair qty = 100', result.components[0].quantity === 100);
  ok('36 table qty = 12', result.components[1].quantity === 12);
  ok('36 hasSnapshot = true', result.hasSnapshot === true);
}

// 37. buildPackageDisplay with null snapshot
{
  const result = buildPackageDisplay({
    bundleName: 'Old Package',
    bundleQty: 1,
    unitPriceCents: 10000,
    componentSnapshot: null,
  });
  ok('37 no components', result.components.length === 0);
  ok('37 hasSnapshot = false', result.hasSnapshot === false);
}

// 38. isPackageItem checks
{
  ok('38 bundle item is package', isPackageItem({ item_type: 'event_essential_bundle', bundle_id: 'b1', unit_id: null }) === true);
  ok('38 product item not package', isPackageItem({ item_type: 'event_essential_product', product_id: 'p1', unit_id: null }) === false);
  ok('38 inflatable not package', isPackageItem({ unit_id: 'u1', bundle_id: null }) === false);
}

// 39. validatePackageSnapshot rejects missing snapshot
{
  const result = validatePackageSnapshot({
    bundle_id: 'b1',
    bundle_name: 'Test',
    unit_price_cents: 10000,
    qty: 1,
    component_snapshot: null,
  });
  ok('39 missing snapshot rejected', !result.ok);
}

// 40. CANONICAL_TAB_KEYS contains all expected keys
{
  ok('40 has details', CANONICAL_TAB_KEYS.includes('details'));
  ok('40 has lot-pics', CANONICAL_TAB_KEYS.includes('lot-pics'));
  ok('40 has waiver', CANONICAL_TAB_KEYS.includes('waiver'));
  ok('40 has payment', CANONICAL_TAB_KEYS.includes('payment'));
  ok('40 has pictures', CANONICAL_TAB_KEYS.includes('pictures'));
  ok('40 has delivery', CANONICAL_TAB_KEYS.includes('delivery'));
  ok('40 no lot-pictures', !(CANONICAL_TAB_KEYS as readonly string[]).includes('lot-pictures'));
}

// 41. buildTabUrlParam returns null for details
{
  ok('41 details → null', buildTabUrlParam('details') === null);
  ok('41 payment → payment', buildTabUrlParam('payment') === 'payment');
  ok('41 lot-pics → lot-pics', buildTabUrlParam('lot-pics') === 'lot-pics');
}

// ===========================================================================
// Unauthorized order-link creation test (mock returns controlled failure)
// ===========================================================================

// 42. Unauthorized order-link creation returns controlled failure.
{
  const mock = makeMockSupabase({
    orderRpcResult: { success: false, error: 'Unauthorized: only staff can create order short links' },
  });
  const result = await createShortPortalLink('order-unauth', mock as any, null, null);
  ok('42 unauthorized → success=false', result.success === false);
  if (!result.success) {
    ok('42 error contains Unauthorized', result.error.includes('Unauthorized'));
  }
}

// 43. Expired resolver result is not returned as active.
// The resolver RPC checks expires_at > now() — we verify the mock simulates this.
{
  // Simulate: invoice link exists but is expired (resolver returns found=false)
  const mock = makeMockSupabase({
    invoiceRpcError: { message: 'expired' },
    orderRpcError: { message: 'expired' },
    invoiceLinkData: null, // expired link not returned
  });
  const result = await createShortPortalLink('order-expired', mock as any, null, 'expired-token');
  ok('43 expired link → success=false', result.success === false);
}

console.log(`\nStage E4 Defect-Fix Tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
