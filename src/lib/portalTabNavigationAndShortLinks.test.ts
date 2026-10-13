// Portal tab navigation and short-link tests, split out of the former stageE4DefectFixes.test.ts. They call the real production helpers.
// createShortPortalLink is tested with a mock client whose functions.invoke answers for the portal-link Edge Function. Who may obtain a link is
// decided by that function and is tested in portalLinks.test.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createShortPortalLink } from './portalShortLink';
import { resolveCustomerPortalTab, buildTabUrlParam, CANONICAL_TAB_KEYS, type PortalNavSection } from './customerPortalTab';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

// Polyfill window.location.origin for Node test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = { location: { origin: 'https://example.com', hash: '', search: '' } };
} else if (typeof (globalThis as any).window.location === 'undefined') {
  (globalThis as any).window.location = { origin: 'https://example.com', hash: '', search: '' };
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

type InvokeCall = { name: string; options: any };

// A client with ONLY functions.invoke: any other call (rpc, from) would throw, which proves there is no database fallback.
function makeMockClient(response: { data?: any; error?: any }) {
  const calls: InvokeCall[] = [];
  return {
    calls,
    functions: {
      invoke(name: string, options: any) {
        calls.push({ name, options });
        return Promise.resolve({ data: response.data ?? null, error: response.error ?? null });
      },
    },
  };
}

// The checks await; the runner loads this file as CommonJS, so everything runs inside an async function.
(async () => {
{ const sections = makeSections(); ok('1 tab=payment → payment', resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'payment'); }

{ const sections = makeSections(); ok('2 tab=lot-pics → lot-pics', resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections }) === 'lot-pics'); }

{ const sections = makeSections(); ok('3 tab=lot-pictures → lot-pics', resolveCustomerPortalTab({ requestedTab: 'lot-pictures', sections }) === 'lot-pics'); }

{ const sections = makeSections(); ok('4 invalid → details', resolveCustomerPortalTab({ requestedTab: 'nonexistent', sections }) === 'details'); }

{ const sections = makeSections({ lockedPayment: true }); ok('5 locked payment → details', resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'details'); }

{ const sections = makeSections(); const r1 = resolveCustomerPortalTab({ requestedTab: 'payment', sections }); const r2 = resolveCustomerPortalTab({ requestedTab: 'payment', sections }); ok('6 payment stays after refresh', r1 === 'payment' && r2 === 'payment'); }

{ const sb = makeSections({ lockedPayment: false }); const sa = makeSections({ lockedPayment: true }); ok('7 payment locked → details', resolveCustomerPortalTab({ requestedTab: 'payment', sections: sb }) === 'payment' && resolveCustomerPortalTab({ requestedTab: 'payment', sections: sa }) === 'details'); }

{ const sections = makeSections(); ok('8 back-nav', resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'payment' && resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections }) === 'lot-pics'); }

{ const sections = makeSections(); ok('9 forward-nav', resolveCustomerPortalTab({ requestedTab: 'lot-pics', sections }) === 'lot-pics' && resolveCustomerPortalTab({ requestedTab: 'payment', sections }) === 'payment'); }

// createShortPortalLink asks the portal-link Edge Function for a short code and builds the customer URL from it. The server decides who
// may obtain a link (portalLinks.test.ts); these checks are about what the browser-side function does with the answer.
{
  const mock = makeMockClient({ data: { success: true, shortCode: 'INV12345' } });
  const result = await createShortPortalLink('order-1', mock as any, null, 'inv-token-1');
  ok('10 success → success', result.success === true);
  if (result.success) { ok('10 url /i/', result.url.includes('/i/')); ok('10 code INV12345', result.shortCode === 'INV12345'); ok('10 url is origin + /i/ + code', result.url === 'https://example.com/i/INV12345'); }
  ok('10 one call, to portal-link', mock.calls.length === 1 && mock.calls[0].name === 'portal-link');
  ok('10 the order id and the invoice token are sent', mock.calls[0].options?.body?.orderId === 'order-1' && mock.calls[0].options?.body?.token === 'inv-token-1');
}

{
  const mock = makeMockClient({ data: { success: true, shortCode: 'ORD67890' } });
  const result = await createShortPortalLink('order-2', mock as any, null, null, 'cs_test_session');
  ok('11 success without a token → success', result.success === true);
  if (result.success) { ok('11 url /i/', result.url.includes('/i/')); }
  ok('11 no token key is sent when there is none', !('token' in (mock.calls[0].options?.body ?? {})));
  ok('11 a Checkout session id is passed through', mock.calls[0].options?.body?.sessionId === 'cs_test_session');
}

{
  const mock = makeMockClient({ error: { message: 'Failed' } });
  const result = await createShortPortalLink('order-3', mock as any, null, 'inv-token-3');
  ok('12 a function error → false', result.success === false);
  if (!result.success) { ok('12 has error', result.error.length > 0); ok('12 the error is the function error', result.error === 'Failed'); }
}

{
  const mock = makeMockClient({ data: { success: false, error: 'Unauthorized' } });
  const result = await createShortPortalLink('order-4', mock as any, null, 'inv-token-4');
  ok('13 a refusal from the server → false (no fallback lookup)', result.success === false && mock.calls.length === 1);
  if (!result.success) { ok('13 the server message is kept', result.error === 'Unauthorized'); }
}

{
  const mock = makeMockClient({ data: { success: true } });
  const result = await createShortPortalLink('order-4b', mock as any, null, null);
  ok('13 a success answer without a short code is a failure', result.success === false);
}

{
  const mock = makeMockClient({ error: { message: 'Failed' } });
  const result = await createShortPortalLink('order-5', mock as any, null, 'inv-token-5');
  ok('14 failure no /customer-portal/', !JSON.stringify(result).includes('/customer-portal/'));
}

{
  const mock = makeMockClient({ error: { message: 'Failed' } });
  const result = await createShortPortalLink('order-6', mock as any, null, null);
  ok('15 failure no /invoice/', !JSON.stringify(result).includes('/invoice/'));
}

{
  const mock = makeMockClient({ data: { success: true, shortCode: 'CODE1234' } });
  const result = await createShortPortalLink('order-7', mock as any, null, null);
  ok('16 success /i/', result.success && result.url.includes('/i/'));
}

// 8. Approval notification uses one short URL for both SMS and email
{
  const mock = makeMockClient({ data: { success: true, shortCode: 'SHARED1' } });
  const result = await createShortPortalLink('order-shared', mock as any, null, 'inv-shared');
  ok('approval-8 one link for both', result.success === true);
  if (result.success) {
    ok('approval-8 url is /i/SHARED1', result.url === 'https://example.com/i/SHARED1');
  }
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

console.log(`\nPortal tab navigation and short-link tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
