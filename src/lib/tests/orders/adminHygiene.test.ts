// WP-06 / WP-16 / NI-08 (B10): confirm dialogs, saved discount templates, order list ordering, error states and date handling.
// PASS - LOCAL AUTOMATED / MOCKED. Real browsers (A-05 one confirmation per action) and A-18..A-21 on Dev are REQUIRES HOSTED DEV VERIFICATION;
// the error-report email through the real relay needs a Dev send (REQUIRES HOSTED DEV VERIFICATION, WP-27 smoke test).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { describeTemplateValue, templateToDiscount } from '../../orders/discountTemplates';
import { localDateKey, parseDateOnly, todayLocalKey } from '../../core/localDate';

declare const require: (id: string) => any;

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
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// Compile a .tsx module with the TypeScript compiler (the runner reads .ts only); `stubs` replaces named packages.
function loadTsx(file: string, stubs: Record<string, any> = {}): any {
  const path = require('path');
  const ts = require('typescript');
  const abs = path.resolve(file);
  const out = ts.transpileModule(require('fs').readFileSync(abs, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText.split('import.meta.env').join('({})');
  const mod: any = { exports: {} };
  const req = (id: string) => {
    if (id in stubs) return stubs[id];
    if (!id.startsWith('.')) return require(id);
    const base = path.resolve(path.dirname(abs), id);
    return require('fs').existsSync(base + '.tsx') ? loadTsx(base + '.tsx', stubs) : require(base);
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
}

async function main() {
  // =====================================================================================================================
  // WP-06: one confirmation per action
  // =====================================================================================================================
  const legacy = read('src/lib/core/legacyAlert.ts');
  ok('window.confirm is no longer overridden', !/\.confirm\s*=/.test(legacy) && !/originalConfirm/.test(legacy));
  ok('window.alert is still replaced (unchanged)', /\(window as any\)\.alert = /.test(legacy));

  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = `${dir}/${f}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !p.includes('/tests/')) srcFiles.push(p);
    }
  };
  walk('src');
  const bareConfirm = srcFiles.filter((f) => /(^|[^\w.$])confirm\(/.test(read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) && !/refundController/.test(f));
  eq('no browser confirm() call is left anywhere in the app', bareConfirm, []);
  for (const [file, n] of [['src/components/order-detail/DiscountsManager.tsx', 2], ['src/components/order-detail/CustomFeesManager.tsx', 2], ['src/components/admin/orders/PendingOrderCard.tsx', 1]] as Array<[string, number]>) {
    const t = read(file);
    ok(`${file}: ${n} confirmation(s) now awaited through the custom dialog`, (t.match(/await showConfirm\(/g) ?? []).length >= n && /import \{ showConfirm \} from '.*CustomModal'/.test(t));
  }
  ok('the two remove handlers are async so they can await the answer', /async function handleRemoveFee/.test(read('src/components/order-detail/CustomFeesManager.tsx')) && /async function handleRemoveDiscount/.test(read('src/components/order-detail/DiscountsManager.tsx')));

  // The real showModal against a stand-in DOM: a replaced modal must resolve false, and Escape must mean "no".
  {
    const renders: any[] = [];
    let unmounted = 0;
    const body: any[] = [];
    (globalThis as any).document = {
      createElement: () => ({}),
      body: { appendChild: (n: any) => body.push(n), removeChild: (n: any) => body.splice(body.indexOf(n), 1), contains: (n: any) => body.includes(n) },
      addEventListener: () => {},
      removeEventListener: () => {},
      head: { appendChild: () => {} },
    };
    const stubs = {
      'react-dom/client': { createRoot: () => ({ render: (el: any) => renders.push(el), unmount: () => { unmounted++; } }) },
      'lucide-react': { AlertCircle: () => null, Info: () => null, CheckCircle: () => null },
    };
    const modal = loadTsx('src/components/common/CustomModal.tsx', stubs);
    const first = modal.showConfirm('Delete the thing?');
    const second = modal.showConfirm('Remove this fee?');
    const firstAnswer = await Promise.race([first, new Promise((r) => setTimeout(() => r('hanging'), 200))]);
    eq('a confirmation that is replaced by another resolves false (it used to hang forever)', firstAnswer, false);
    ok('the replaced modal was unmounted', unmounted >= 1);
    renders[renders.length - 1].props.onConfirm();
    eq('the replacing confirmation answers true on Confirm', await second, true);
    const third = modal.showConfirm('Sure?');
    renders[renders.length - 1].props.onCancel();
    eq('Cancel answers false', await third, false);
    const alertOnly = modal.showAlert('Heads up');
    renders[renders.length - 1].props.onConfirm();
    eq('an OK-only message resolves true on OK', await alertOnly, true);
    ok('no Cancel button is offered for an OK-only message', renders[renders.length - 1].props.cancelText === undefined);
    delete (globalThis as any).document;
  }
  const customModal = read('src/components/common/CustomModal.tsx');
  ok('the dialog is announced as a dialog and handles Escape', /aria-modal="true"/.test(customModal) && /alertdialog/.test(customModal) && /e\.key !== 'Escape'/.test(customModal));

  // =====================================================================================================================
  // WP-16: saved discount templates read the real columns
  // =====================================================================================================================
  eq('fixed template applies its amount', templateToDiscount({ amount_cents: 2500, percentage: 0 }), { amount_cents: 2500, percentage: 0 });
  eq('percentage template applies its percentage', templateToDiscount({ amount_cents: 0, percentage: 15 }), { amount_cents: 0, percentage: 15 });
  eq('null columns apply nothing instead of NaN', templateToDiscount({ amount_cents: null, percentage: null }), { amount_cents: 0, percentage: 0 });
  eq('numeric strings from the database are accepted', templateToDiscount({ amount_cents: '1000' as any, percentage: '0' as any }), { amount_cents: 1000, percentage: 0 });
  eq('a row holding both uses the fixed amount only', templateToDiscount({ amount_cents: 500, percentage: 10 }), { amount_cents: 500, percentage: 0 });
  eq('negative values are ignored', templateToDiscount({ amount_cents: -5, percentage: -1 }), { amount_cents: 0, percentage: 0 });
  eq('label for a fixed template', describeTemplateValue({ amount_cents: 2500, percentage: 0 }), '$25.00');
  eq('label for a percentage template', describeTemplateValue({ amount_cents: 0, percentage: 12.5 }), '12.5%');
  const dm = read('src/components/order-detail/DiscountsManager.tsx');
  ok('the screen no longer reads discount_type / discount_value (columns that do not exist)', !/discount_type|discount_value/.test(dm + read('src/hooks/invoices/useDiscountTemplates.ts')));
  ok('the template hook exposes a load error', /setError\(true\)/.test(read('src/hooks/invoices/useDiscountTemplates.ts')));

  // =====================================================================================================================
  // WP-16: orders list ordering and the Admin pending list
  // =====================================================================================================================
  const queries = read('src/lib/queries/orders.ts');
  const allOrders = queries.slice(queries.indexOf('export async function getAllOrdersWithContacts'));
  ok('the capped orders list is newest-first, so the cap drops the oldest history', /\.order\('event_date', \{ ascending: false \}\);\n\n\s+if \(limit\)/.test(allOrders));
  const admin = read('src/pages/Admin.tsx');
  ok('Admin loads pending-review orders with their own query (never crowded out by newer confirmed/draft orders)', /\.eq\('status', ORDER_STATUS\.PENDING\)(\.eq\('order_changelog\.change_type', 'travel_city_review'\))?\.order\('created_at', \{ ascending: false \}\)\.limit\(200\)/.test(admin) && /\.in\('status', \[ORDER_STATUS\.DRAFT, ORDER_STATUS\.CONFIRMED\]\)/.test(admin));
  ok('Admin merges both lists and surfaces either error', /if \(pendingRes\.error\) throw pendingRes\.error;/.test(admin) && /if \(otherRes\.error\) throw otherRes\.error;/.test(admin) && /\[\.\.\.\(pendingRes\.data \|\| \[\]\), \.\.\.\(otherRes\.data \|\| \[\]\)\]/.test(admin));
  ok('Admin shows a retry screen when the first load failed (instead of an empty "No pending bookings")', /if \(loadError && !data\)/.test(admin) && /The admin data could not be loaded/.test(admin));
  ok('Admin pricing tab says so when the rules did not load', /activeTab === 'pricing' && !pricingRules/.test(admin) && /pricing rules could not be loaded/.test(admin));

  // =====================================================================================================================
  // WP-16: payments load errors are not shown as "$0 paid"
  // =====================================================================================================================
  const details = read('src/hooks/admin/useAdminOrderDetails.ts');
  ok('order and payment queries throw their errors into the shared catch', /const \{ data, error \} = await getOrderById\(forOrderId\);\n\s+if \(error\) throw error;/.test(details) && /const \{ data, error \} = await getOrderPayments\(forOrderId\);\n\s+if \(error\) throw error;/.test(details));
  ok('the hook exposes loadError and clears it on a new load', /setLoadError\(true\)/.test(details) && /setLoadError\(false\)/.test(details) && /loadError,\n\s+reload: loadData/.test(details));
  const tab = read('src/components/order-detail/PaymentsTab.tsx');
  ok('the payments tab replaces the figures with a message and Try again when the load failed', /if \(loadError\) \{/.test(tab) && /Payments could not be loaded/.test(tab) && tab.indexOf('if (loadError)') < tab.indexOf('Total Paid'));
  ok('the order modal wires the error and the retry', /loadError=\{orderDataLoadError\}/.test(read('src/components/admin/orders/OrderDetailModal.tsx')));

  // =====================================================================================================================
  // WP-16: the Street View panel with no address
  // =====================================================================================================================
  {
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const sv = loadTsx('src/components/pending-order/StreetViewImages.tsx');
    let html = 'unset';
    let threw: any = null;
    try {
      html = renderToStaticMarkup(createElement(sv.StreetViewImages, { address: null, orderCreatedAt: '2026-01-01', selectedImage: null, onSelectImage: () => {} }));
    } catch (e) {
      threw = e;
    }
    ok('an order with no address renders nothing instead of crashing', !threw && html === '');
  }

  // =====================================================================================================================
  // WP-16: customer-facing dates are local
  // =====================================================================================================================
  const d = parseDateOnly('2026-11-10');
  eq('a date-only string is that calendar day in any time zone (noon local)', [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 10, 10, 12]);
  eq('a date with a time part still reads as its day', parseDateOnly('2026-11-10T23:30:00Z').getDate(), 10);
  eq('a non-date falls back to the Date constructor', Number.isNaN(parseDateOnly('nope').getTime()), true);
  eq('today key matches the local day', todayLocalKey(new Date(2026, 10, 9, 22, 45)), '2026-11-09');
  eq('local key round trip', localDateKey(parseDateOnly('2027-01-31')), '2027-01-31');
  for (const f of ['src/components/customer-portal/CancelOrderModal.tsx', 'src/components/quote/EventDetailsSection.tsx', 'src/pages/Home.tsx', 'src/pages/Catalog.tsx']) {
    ok(`${f}: no UTC date arithmetic left`, !/toISOString\(\)\.split\('T'\)/.test(read(f)) && !/new Date\(eventDate\)/.test(read(f)));
  }
  ok('the quote date range moves the end date with the start date in local time', /parseDateOnly\(newStartDate\)/.test(read('src/components/quote/EventDetailsSection.tsx')) && /localDateKey\(newEnd\)/.test(read('src/components/quote/EventDetailsSection.tsx')));

  // =====================================================================================================================
  // NI-08: browser error reports reach the relay that exists
  // =====================================================================================================================
  const notify = read('supabase/functions/send-error-notification/index.ts');
  ok('the report is sent through send-email with a plain recipient, once, without the SMS fallback', /invoke\(\s*'send-email'/.test(notify) && /to: adminEmail,/.test(notify) && /skipFallback: true/.test(notify));
  ok('no function named "resend" is called or exists', !/'resend'/.test(notify) && !existsSync('supabase/functions/resend'));

  console.log(`adminHygiene: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} admin hygiene test(s) failed`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
