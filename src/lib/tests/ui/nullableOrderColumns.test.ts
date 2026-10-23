// Database-types reconciliation (cluster: orders / payments screens). The generated database types say several order, payment, refund and
// SMS columns are NULLABLE (status and created_at default to 'pending' / now(), so the application never writes NULL, but the schema allows
// it). These tests pin how the screens treat such a row: they render it instead of throwing, a present value formats exactly as before, and
// the one place that read a nullable discount amount as a plain number now reads NULL as 0, as the table's own CHECK does.
// PASS - LOCAL AUTOMATED (rendered with react-dom/server; no network, no database).
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles for components and the supabase client */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { formatNullableTimestamp } from '../../core/formatNullableTimestamp';

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
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

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
const noop = () => null;
const stubs = {
  '../admin/orders/refunds/RefundAllocationPanel': { RefundAllocationPanel: noop },
  '../../lib/supabase': { supabase: {} },
  '../../lib/toasts': { showToast: () => undefined, notifyError: () => undefined, notifySuccess: () => undefined },
};

// --- the helper -----------------------------------------------------------------------------------------------------------------------
ok('a present timestamp formats as before', formatNullableTimestamp('2030-06-01T15:30:00', 'MMM d, yyyy h:mm a') === 'Jun 1, 2030 3:30 PM');
ok('NULL gives an empty string, not a 1970 date', formatNullableTimestamp(null, 'MMM d, yyyy h:mm a') === '');
ok('undefined gives an empty string', formatNullableTimestamp(undefined, 'MMM d, yyyy h:mm a') === '');

// --- PaymentsTab (Admin order editor, payments list) ------------------------------------------------------------------------------------
{
  const { PaymentsTab } = loadTsx('src/components/order-detail/PaymentsTab.tsx', stubs);
  const base = { id: 'p1', order_id: 'o1', type: 'deposit', amount_cents: 5000, stripe_payment_intent_id: null, payment_method: null, paid_at: null };
  const render = (payments: any[]) => renderToStaticMarkup(createElement(PaymentsTab, { orderId: 'o1', customerName: 'Ann', payments, onPaymentsUpdate: () => undefined }));
  let html = '';
  let threw = false;
  try { html = render([{ ...base, status: null, created_at: null }]); } catch { threw = true; }
  ok('a payment with a NULL status and NULL created_at renders (it used to throw on status.toUpperCase())', !threw && /\$50\.00/.test(html));
  const normal = render([{ ...base, status: 'succeeded', created_at: '2030-06-01T15:30:00' }]);
  ok('a normal payment still shows SUCCEEDED and its Created date', /SUCCEEDED/.test(normal) && /Created: Jun 1, 2030/.test(normal));
  const paid = render([{ ...base, status: 'succeeded', created_at: '2030-06-01T15:30:00', paid_at: '2030-06-02T09:00:00' }]);
  ok('a paid payment still shows its Paid date', /Paid: Jun 2, 2030/.test(paid));
}

// --- PaymentManagementSection (pending-order card) ------------------------------------------------------------------------------------------
{
  const { PaymentManagementSection } = loadTsx('src/components/pending-order/PaymentManagementSection.tsx', stubs);
  const order = { id: 'o1', status: 'pending_review', subtotal_cents: 10000, deposit_due_cents: 5000, balance_due_cents: 5000 };
  let threw = false;
  let html = '';
  try {
    html = renderToStaticMarkup(createElement(PaymentManagementSection, {
      order,
      payments: [{ id: 'p1', amount_cents: 5000, status: null, type: 'deposit', created_at: null }],
      refunds: [{ id: 'r1', amount_cents: 100, reason: 'customer_request', status: null, created_at: null }],
      customFees: [],
      discounts: [{ name: 'Promo', amount_cents: null, percentage: 10 }],
      onRefundSuccess: () => undefined,
    }));
  } catch { threw = true; }
  ok('payments, refunds and discounts with NULL columns render', !threw && /\$50\.00/.test(html) && /\$1\.00/.test(html));
}

// --- SmsConversation --------------------------------------------------------------------------------------------------------------------------------
{
  const { SmsConversation } = loadTsx('src/components/pending-order/SmsConversation.tsx', stubs);
  const html = renderToStaticMarkup(createElement(SmsConversation, { messages: [{ id: 'm1', direction: 'inbound', message_body: 'Hello', created_at: null }, { id: 'm2', direction: 'outbound', message_body: 'Hi', created_at: '2030-06-01T15:30:00' }], onSendMessage: async () => true, isSending: false }));
  ok('an SMS row with a NULL created_at renders its text without a date; a dated one shows the time', /Hello/.test(html) && /Hi/.test(html) && /Jun 1, 3:30 PM/.test(html));
}

// --- source pins for the type-only and one-value changes --------------------------------------------------------------------------------------------
const lifecycle = read('src/lib/orders/orderLifecycleApi.ts');
ok('enterConfirmed accepts a NULL status hint and still sends it only when truthy (null and undefined behave the same)', /oldStatusHint\?: string \| null,/.test(lifecycle) && /\.\.\.\(oldStatusHint \? \{ oldStatusHint \} : \{\}\)/.test(lifecycle));
const modal = read('src/components/admin/orders/OrderDetailModal.tsx');
ok('loaded discounts read NULL amount_cents / percentage as 0 (as the CHECK constraint and staff-order-save do), for the editor state AND the loaded-pricing baseline', /amount_cents: d\.amount_cents \?\? 0, percentage: d\.percentage \?\? 0/.test(modal) && /loadedDiscountsRef\.current = loadedDiscounts;\n\s+setDiscounts\(loadedDiscounts\);/.test(modal));
const header = read('src/components/admin/orders/AdminFloatingOrderHeader.tsx');
ok('the floating header reads a nullable status safely', /order\.status\?\.replace\(/.test(header));
const info = read('src/components/pending-order/OrderInfoSection.tsx');
ok('the status badge lookup still falls back to the neutral colour for a NULL status', /\(order\.status \? STATUS_BADGE_COLORS\[order\.status\] : undefined\) \?\? 'bg-slate-600'/.test(info));

console.log(`nullableOrderColumns: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} nullable order column test(s) failed`);
