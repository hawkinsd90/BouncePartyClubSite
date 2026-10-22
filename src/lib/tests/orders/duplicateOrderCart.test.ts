// WP-01 (B6): My Orders and duplication for Event Essentials orders.
// PASS - LOCAL AUTOMATED. Manual C-04/C-05/E-03/E-04/E-15 on Dev are REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { buildDuplicateCart, describeOrderLine, duplicateCanStake } from '../../orders/duplicateOrderCart';
declare const require: (id: string) => any;

// OrderCard is a .tsx module and the runner only reads .ts, so it is compiled here with the TypeScript compiler and evaluated with the
// real react / lucide-react / date-fns and the real project modules it imports (same approach as refundAllocationUi.test.ts).
const tsxCache: Record<string, any> = {};
function loadTsx(file: string): any {
  const path = require('path');
  const ts = require('typescript');
  const abs = path.resolve(file);
  const out = ts.transpileModule(require('fs').readFileSync(abs, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  if (tsxCache[abs]) return tsxCache[abs];
  const mod: any = { exports: {} };
  tsxCache[abs] = mod.exports;
  const req = (id: string) => {
    if (!id.startsWith('.')) return require(id);
    const base = path.resolve(path.dirname(abs), id);
    return require('fs').existsSync(base + '.tsx') ? loadTsx(base + '.tsx') : require(base);
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
}
// The card imports the app's Supabase client module (only to type-check totals); give it the browser globals it expects. Nothing is called.
const memoryStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
(globalThis as any).window ??= { location: { origin: 'https://site.test', hash: '', search: '', pathname: '/' }, open: () => null, addEventListener() {}, removeEventListener() {}, localStorage: memoryStorage(), sessionStorage: memoryStorage() };
const { OrderCard } = loadTsx('src/components/dashboard/OrderCard.tsx');

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

const castle = { id: 'i1', unit_id: 'u1', product_id: null, bundle_id: null, item_name: null, pricing_context: null, component_snapshot: null, qty: 1, wet_or_dry: 'water', unit_price_cents: 20000,
  units: { id: 'u1', name: 'Mega Castle', active: true, types: ['Combo'], is_combo: false, price_dry_cents: 15000, price_water_cents: 20000 } };
const retired = { ...castle, id: 'i2', unit_id: 'u2', units: { ...castle.units, id: 'u2', name: 'Old Slide', active: false } };
const chairs = { id: 'i3', unit_id: null, product_id: 'p1', bundle_id: null, item_name: 'Folding Chair', pricing_context: 'standalone', component_snapshot: null, qty: 20, wet_or_dry: null, unit_price_cents: 300, units: null };
const addonTable = { id: 'i4', unit_id: null, product_id: 'p2', bundle_id: null, item_name: 'Round Table', pricing_context: 'addon', component_snapshot: null, qty: 2, wet_or_dry: null, unit_price_cents: 800, units: null };
const snapshot = { bundle_name: 'Party Package', bundle_description: null, components: [{ product_id: 'p1', product_name: 'Folding Chair', quantity_per_bundle: 10 }] };
const pkg = { id: 'i5', unit_id: null, product_id: null, bundle_id: 'b1', item_name: 'Party Package', pricing_context: 'standalone', component_snapshot: snapshot, qty: 1, wet_or_dry: null, unit_price_cents: 9000, units: null };

async function main() {
  // --- duplication ---------------------------------------------------------------------------------------------
  const inflatableOnly = buildDuplicateCart([castle]);
  eq('inflatable-only: one inflatable line, nothing unavailable', [inflatableOnly.cartItems.length, inflatableOnly.unavailable], [1, []]);
  const c0: any = inflatableOnly.cartItems[0];
  eq('inflatable line keeps unit, mode, quantity and both prices', [c0.item_type, c0.unit_id, c0.wet_or_dry, c0.qty, c0.price_dry_cents, c0.price_water_cents, c0.is_combo], ['inflatable', 'u1', 'water', 1, 15000, 20000, true]);

  const eeOnly = buildDuplicateCart([chairs, addonTable, pkg]);
  eq('EE-only order is duplicable: product, add-on product and package all come across', eeOnly.cartItems.map((c: any) => [c.item_type, c.product_id ?? c.bundle_id, c.qty, c.pricing_context]), [
    ['event_essential_product', 'p1', 20, 'standalone'],
    ['event_essential_product', 'p2', 2, 'addon'],
    ['event_essential_bundle', 'b1', 1, 'standalone'],
  ]);
  eq('EE-only: nothing reported unavailable', eeOnly.unavailable, []);
  const bundleLine: any = eeOnly.cartItems[2];
  eq('package keeps its name, price and stored contents', [bundleLine.bundle_name, bundleLine.unit_price_cents, bundleLine.component_snapshot.components.length], ['Party Package', 9000, 1]);
  eq('product keeps its name and price', [(eeOnly.cartItems[0] as any).product_name, eeOnly.cartItems[0].unit_price_cents], ['Folding Chair', 300]);

  const mixed = buildDuplicateCart([castle, chairs, pkg]);
  eq('mixed order keeps inflatable AND Event Essentials lines', mixed.cartItems.map((c: any) => c.item_type), ['inflatable', 'event_essential_product', 'event_essential_bundle']);

  const withRetired = buildDuplicateCart([castle, retired, chairs]);
  eq('a retired inflatable is reported by name and the rest is kept', [withRetired.unavailable, withRetired.cartItems.length], [['Old Slide'], 2]);
  eq('only retired items: nothing in the cart', buildDuplicateCart([retired]).cartItems.length, 0);
  eq('a line that is neither inflatable nor Event Essentials is reported, not dropped silently', buildDuplicateCart([{ id: 'x', qty: 1, item_name: 'Mystery' }]).unavailable, ['Mystery']);
  const badSnapshot: any = buildDuplicateCart([{ ...pkg, component_snapshot: null }]).cartItems[0];
  eq('a package with no stored contents still comes across (Quote re-derives them)', [badSnapshot.item_type, badSnapshot.component_snapshot.components], ['event_essential_bundle', []]);
  eq('zero / missing quantity becomes 1', buildDuplicateCart([{ ...chairs, qty: 0 }]).cartItems[0].qty, 1);
  eq('empty / missing input', [buildDuplicateCart([]).cartItems, buildDuplicateCart(undefined as any).cartItems], [[], []]);

  // --- stakes prefill ----------------------------------------------------------------------------------------------
  eq('grass surface => stakes allowed', duplicateCanStake({ surface: 'grass', can_use_stakes: false }, true), true);
  eq('cement surface => no stakes', duplicateCanStake({ surface: 'cement', can_use_stakes: true }, true), false);
  eq('no surface: falls back to the stored flag', duplicateCanStake({ surface: null, can_use_stakes: true }, true), true);
  eq('nothing known: unanswered (null), not false', duplicateCanStake({ surface: null, can_use_stakes: null }, true), null);
  eq('EE-only cart: the stakes question is not asked', duplicateCanStake({ surface: 'grass', can_use_stakes: true }, false), null);

  // --- line display -------------------------------------------------------------------------------------------------
  eq('inflatable line shows its name and Wet badge', describeOrderLine(castle), { name: 'Mega Castle', badge: 'Wet' });
  eq('dry inflatable shows Dry', describeOrderLine({ ...castle, wet_or_dry: 'dry' }).badge, 'Dry');
  eq('EE product shows its name and no badge', describeOrderLine(chairs), { name: 'Folding Chair', badge: null });
  eq('EE package with no item_name falls back to the snapshot name', describeOrderLine({ ...pkg, item_name: null }), { name: 'Party Package', badge: null });
  eq('a line with nothing to name it still renders', describeOrderLine({ id: 'z', units: null }), { name: 'Event Essentials item', badge: null });

  // --- the card actually renders (this is the crash being fixed) ----------------------------------------------------
  const baseOrder: any = {
    id: '11111111-2222-4333-8444-555555555555', status: 'confirmed', event_date: '2027-06-12', event_end_date: '2027-06-12', event_start_time: null, event_end_time: null,
    start_window: '10:00', end_window: '14:00', location_type: 'residential', subtotal_cents: 6000, travel_fee_cents: 0, surface_fee_cents: 0, tax_cents: 0,
    deposit_due_cents: 5000, deposit_paid_cents: 5000, balance_due_cents: 1000, balance_paid_cents: 0, customers: { first_name: 'A', last_name: 'B', email: 'a@b.test', phone: null },
    addresses: { line1: '1 Main St', city: 'Detroit', state: 'MI', zip: '48201' }, waiver_signed_at: null, signed_waiver_url: null, payments: [], order_discounts: [], order_custom_fees: [],
  };
  const render = (items: any[]) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(OrderCard, { order: { ...baseOrder, order_items: items }, onViewReceipt: () => {}, onDuplicateOrder: () => {}, onCancelOrder: () => {} })));
  let html = '';
  let threw: any = null;
  try { html = render([chairs, pkg]); } catch (e) { threw = e; }
  ok('EE-only order card renders without throwing', !threw);
  ok('EE-only card shows the item names and quantity', /20x Folding Chair/.test(html) && /Party Package/.test(html));
  ok('EE-only card has no Wet/Dry badge', !/>Wet<|>Dry<|text-\[10px\]/.test(html));
  threw = null;
  try { html = render([castle, chairs]); } catch (e) { threw = e; }
  ok('mixed order card renders', !threw);
  ok('mixed card badges only the inflatable', /Mega Castle/.test(html) && (html.match(/>Wet</g) ?? []).length === 1 && /Folding Chair/.test(html));
  threw = null;
  try { render([]); render(undefined as any); } catch (e) { threw = e; }
  ok('an order with no lines still renders', !threw);

  // --- source guards ------------------------------------------------------------------------------------------------
  const receipt = read('src/pages/Receipt.tsx');
  const modal = read('src/components/dashboard/ReceiptModal.tsx');
  ok('receipt page and modal never dereference order.customers without a guard', !/order\.customers\.(first_name|last_name|email|phone)/.test(receipt + modal));
  ok('duplication hook delegates to the pure builder and no longer reads item.units.name', /buildDuplicateCart\(/.test(read('src/hooks/orders/useOrderDuplication.ts')) && !/item\.units\.name/.test(read('src/hooks/orders/useOrderDuplication.ts')));
  ok('card no longer reads item.units.name', !/item\.units\.name/.test(read('src/components/dashboard/OrderCard.tsx')));

  console.log(`duplicateOrderCart: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} duplicate order cart test(s) failed`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
