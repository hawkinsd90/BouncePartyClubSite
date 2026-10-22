// WP-08 (B6): what the Customer Portal and My Orders show while loading and after a failure.
// PASS - LOCAL AUTOMATED. Offline / slow-network behaviour on a real phone and the "edit on desktop, phone updates" test are
// REQUIRES HOSTED DEV VERIFICATION (C-17, live-update test).
import { readFileSync } from 'node:fs';
import { INITIAL_PORTAL_LOAD_STATE, portalLoadReducer, type PortalLoadEvent, type PortalLoadState } from '../../portal/portalLoadState';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8');
const run = (events: PortalLoadEvent[], from: PortalLoadState = INITIAL_PORTAL_LOAD_STATE) => events.reduce(portalLoadReducer, from);
const loaded = run([{ type: 'start', silent: false }, { type: 'outcome', silent: false, kind: 'ok' }]);

// first load
eq('starts on the spinner with nothing loaded', INITIAL_PORTAL_LOAD_STATE, { hasData: false, loading: true, accessRequired: false, loadError: false, refreshFailed: false });
eq('first load ok: view shown', loaded, { hasData: true, loading: false, accessRequired: false, loadError: false, refreshFailed: false });
eq('first load fails (offline / 500): a load error with Retry, not a not-found', run([{ type: 'start', silent: false }, { type: 'outcome', silent: false, kind: 'error' }]), { hasData: false, loading: false, accessRequired: false, loadError: true, refreshFailed: false });
eq('first load refused (403): secure access required', run([{ type: 'start', silent: false }, { type: 'outcome', silent: false, kind: 'access_required' }]), { hasData: false, loading: false, accessRequired: true, loadError: false, refreshFailed: false });
eq('Retry after a load error shows the spinner again and clears the error', run([{ type: 'start', silent: false }], run([{ type: 'outcome', silent: false, kind: 'error' }])).loadError, false);
eq('Retry after a load error succeeds', run([{ type: 'start', silent: false }, { type: 'outcome', silent: false, kind: 'ok' }], run([{ type: 'outcome', silent: false, kind: 'error' }])).hasData, true);
eq('no order id: spinner stops (nothing to load)', run([{ type: 'no_order_id', silent: false }]).loading, false);

// reload after an action (payment, cancel, invoice): the view must NOT blank
eq('post-action reload keeps the loaded view in place (no full-page spinner)', run([{ type: 'start', silent: false }], loaded).loading, false);
eq('post-action reload ok keeps the view', run([{ type: 'start', silent: false }, { type: 'outcome', silent: false, kind: 'ok' }], loaded).hasData, true);
eq('post-action reload fails: view kept, notice shown', run([{ type: 'start', silent: false }, { type: 'outcome', silent: false, kind: 'error' }], loaded), { hasData: true, loading: false, accessRequired: false, loadError: false, refreshFailed: true });
eq('post-action reload refused: access required (the customer asked for it)', run([{ type: 'outcome', silent: false, kind: 'access_required' }], loaded).accessRequired, true);

// background polling
eq('silent start changes nothing', run([{ type: 'start', silent: true }], loaded), loaded);
eq('silent refresh unchanged: still fine', run([{ type: 'outcome', silent: true, kind: 'unchanged' }], loaded), loaded);
eq('silent refresh fails (offline): view kept, notice shown', run([{ type: 'outcome', silent: true, kind: 'error' }], loaded).refreshFailed, true);
eq('silent refresh fails: nothing is blanked and there is no load error', run([{ type: 'outcome', silent: true, kind: 'error' }], loaded), { hasData: true, loading: false, accessRequired: false, loadError: false, refreshFailed: true });
eq('silent 403 does NOT swap a working screen for the access page', run([{ type: 'outcome', silent: true, kind: 'access_required' }], loaded), { hasData: true, loading: false, accessRequired: false, loadError: false, refreshFailed: true });
const failedRefresh = run([{ type: 'outcome', silent: true, kind: 'error' }], loaded);
eq('the next good refresh clears the notice', run([{ type: 'outcome', silent: true, kind: 'ok' }], failedRefresh).refreshFailed, false);
eq('an unchanged refresh after a failure also clears the notice (connection is back)', run([{ type: 'outcome', silent: true, kind: 'unchanged' }], failedRefresh).refreshFailed, false);
eq('silent failure before anything loaded is still a load error with Retry', run([{ type: 'outcome', silent: true, kind: 'error' }]).loadError, true);

// wiring
const portal = read('src/pages/CustomerPortal.tsx');
ok('portal shows the retry screen for a load error and keeps "Order Not Found" for nothing else', /loadError && !data\?\.order/.test(portal) && /PortalLoadError/.test(portal));
ok('portal refreshes when the browser comes back online', /addEventListener\('online'/.test(portal) && /removeEventListener\('online'/.test(portal));
ok('portal shows the refresh notice over an already-loaded screen', (portal.match(/refreshFailed && <PortalRefreshNotice/g) ?? []).length === 2);
ok('portal hook is driven by the reducer, not ad-hoc flags', /useReducer\(portalLoadReducer/.test(read('src/hooks/portal/useCustomerPortalOrder.ts')));
const orders = read('src/hooks/orders/useOrders.ts');
ok('My Orders reports a failed load instead of silently looking empty', (orders.match(/setLoadError\(true\)/g) ?? []).length === 2 && /loadError,/.test(orders));
const dash = read('src/pages/CustomerDashboard.tsx');
ok('My Orders shows a Retry when the load failed with nothing to show', /failedWithNothingToShow/.test(dash) && /We couldn't load your orders/.test(dash) && !/No Orders Yet[\s\S]{0,40}failedWithNothingToShow/.test(dash));
ok('My Orders tab changes replace history (Back leaves the page instead of bouncing between tabs)', /setSearchParams\(\{ tab \}, \{ replace: options\.replace \?\? true \}\)/.test(dash));
for (const f of ['src/pages/Receipt.tsx', 'src/pages/Sign.tsx']) {
  const t = read(f);
  ok(`${f}: an access error offers the request-new-link screen`, /<SecureAccessRequired orderId=\{orderId\} \/>/.test(t) && /setAccessRequired\(true\)/.test(t));
}

console.log(`portalLoadState: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} portal load state test(s) failed`);
