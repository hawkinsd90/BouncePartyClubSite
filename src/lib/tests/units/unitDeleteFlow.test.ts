// The Admin's delete-unit and deactivate-unit flows, executed through the REAL components (InventorySection's Delete button, UnitForm's Active
// checkbox) with the repository's hand-rolled hooks runner, a scripted Supabase client and a scripted confirmation dialog.
//
// Defect: the future-bookings lookup returned [] when it FAILED, so a failed (or timed-out, or offline) check looked like "no future bookings"
// and the Admin could delete or deactivate a unit that might still be booked. The rule now: only a SUCCESSFUL check clears the way; a failed
// check blocks the action and offers Try again / Cancel; the delete request is never sent while the check is unknown.
/* eslint-disable @typescript-eslint/no-explicit-any -- React element trees, scripted Supabase client and dialog */
import { runHook, loadModuleWithMocks } from '../support/hookHarness';

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

const exists = (p: string) => require('fs').existsSync(p);
const futureBooking = require('../../units/futureBooking');
const gate = exists('src/lib/units/futureBookingGate.ts') ? require('../../units/futureBookingGate') : null;
const errorLike = require('../../core/errorLike');
const localDate = require('../../core/localDate');

// ---- scripted world ----------------------------------------------------------------------------------------------------------------------
type Lookup = () => Promise<{ data: any; error: any }>;
interface World {
  lookups: Lookup[]; // one per call to the future-bookings query, in order (the last one repeats)
  lookupCalls: number;
  deleteCalls: string[];
  confirms: Array<{ message: string; options?: any }>;
  answers: boolean[]; // answers to the confirmation dialog, in order
  toasts: string[];
  unit: any;
}
function newWorld(lookups: Lookup[], answers: boolean[]): World {
  return {
    lookups,
    lookupCalls: 0,
    deleteCalls: [],
    confirms: [],
    answers,
    toasts: [],
    unit: { name: 'Castle', slug: 'castle', types: ['Bounce House'], is_combo: false, price_dry_cents: 15000, price_water_cents: null, dimensions: '13x13', dimensions_water: null, footprint_sqft: 169, power_circuits: 1, capacity: 8, indoor_ok: true, outdoor_ok: true, active: true, quantity_available: 1 },
  };
}
function fakeSupabase(w: World) {
  return {
    from(table: string) {
      if (table === 'order_items') {
        const chain: any = {};
        for (const m of ['select', 'eq', 'not']) chain[m] = () => chain;
        chain.or = () => {
          const i = Math.min(w.lookupCalls, w.lookups.length - 1);
          w.lookupCalls++;
          return w.lookups[i]();
        };
        return chain;
      }
      if (table === 'units') {
        return {
          delete: () => ({ eq: (_c: string, id: string) => { w.deleteCalls.push(id); return Promise.resolve({ error: null }); } }),
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: w.unit, error: null }) }) }),
        };
      }
      if (table === 'unit_media') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
      throw new Error('unexpected table ' + table);
    },
  };
}
const toastModule = (w: World) => ({
  notifyError: (m: string) => w.toasts.push('error:' + m),
  notifySuccess: (m: string) => w.toasts.push('ok:' + m),
  showConfirm: (message: string, options?: any) => {
    w.confirms.push({ message, options });
    return Promise.resolve(w.answers.length ? (w.answers.shift() as boolean) : false);
  },
});
const lucide = new Proxy({}, { get: (_t, name: string) => Object.assign(() => null, { displayName: name }) });

// ---- element-tree helpers ------------------------------------------------------------------------------------------------------------------
function walk(node: any, visit: (el: any) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (node.props) walk(node.props.children, visit);
}
function text(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return node && node.props ? text(node.props.children) : '';
}
function findAll(tree: any, pred: (el: any) => boolean): any[] {
  const out: any[] = [];
  walk(tree, (el) => { if (pred(el)) out.push(el); });
  return out;
}

// ---- component loaders ----------------------------------------------------------------------------------------------------------------------
function loadInventory(w: World) {
  const mocks: Record<string, unknown> = {
    react: require('react'),
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-router-dom': { useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(), () => {}] },
    '../../../lib/supabase': { supabase: fakeSupabase(w) },
    '../../../lib/pricing': { formatCurrency: (c: number) => '$' + (c / 100).toFixed(2) },
    '../../../lib/core/localDate': localDate,
    'lucide-react': lucide,
    '../../../lib/toasts': toastModule(w),
    './event-essentials/EventEssentialsAdmin': { EventEssentialsAdmin: () => null },
    '../../../lib/units/futureBooking': futureBooking,
    '../../../lib/units/futureBookingGate': gate ?? {},
  };
  return loadModuleWithMocks('src/components/admin/catalog/InventorySection.tsx', mocks).InventorySection;
}
function loadUnitForm(w: World) {
  const mocks: Record<string, unknown> = {
    react: require('react'),
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-router-dom': { useNavigate: () => () => {}, useParams: () => ({ id: 'unit-1' }) },
    '../lib/supabase': { supabase: fakeSupabase(w) },
    'lucide-react': lucide,
    '../lib/toasts': toastModule(w),
    '../lib/core/localDate': localDate,
    '../lib/units/futureBooking': futureBooking,
    '../lib/units/futureBookingGate': gate ?? {},
    '../lib/core/errorLike': errorLike,
  };
  return loadModuleWithMocks('src/pages/UnitForm.tsx', mocks).UnitForm;
}

const booking = (n: number) => ({
  order_id: `o${n}`,
  orders: { id: `a1b2c3d4-0000-4000-8000-00000000000${n}`, event_date: `2030-06-0${n}`, event_end_date: `2030-06-0${n}`, status: 'confirmed', customers: { first_name: 'Ann', last_name: `Lee${n}` } },
});
const ok0: Lookup = () => Promise.resolve({ data: [], error: null });
const withBookings = (k: number): Lookup => () => Promise.resolve({ data: Array.from({ length: k }, (_, i) => booking(i + 1)), error: null });
const dbError: Lookup = () => Promise.resolve({ data: null, error: { message: 'permission denied for table orders', code: '42501' } });
const offline: Lookup = () => Promise.reject(new TypeError('Failed to fetch'));

// Returns an exception that escaped the click handler (a lookup that throws must be handled, not crash the screen).
async function clickDelete(w: World): Promise<unknown> {
  const Inventory = loadInventory(w);
  const units = [{ id: 'unit-1', name: 'Castle', type: 'Bounce House', dimensions: '13x13', price_dry_cents: 15000, price_water_cents: null, capacity: 8, active: true, is_combo: false }];
  const run = runHook(Inventory, { units, onRefetch: () => w.toasts.push('refetch') });
  const trash = findAll(run.result, (el) => el.type === 'button' && findAll(el, (c) => c.type && c.type.displayName === 'Trash2').length > 0)[0];
  if (!trash) throw new Error('delete button not found');
  try {
    await trash.props.onClick();
    return null;
  } catch (e) {
    return e ?? new Error('thrown');
  }
}
async function toggleActiveOff(w: World): Promise<{ active: boolean }> {
  const UnitForm = loadUnitForm(w);
  const run = runHook(UnitForm, {});
  await run.settle(5);
  const checkbox = () =>
    findAll(run.result, (el) => el.type === 'label' && /Active/.test(text(el)) && findAll(el, (c) => c.type === 'input' && c.props.type === 'checkbox').length > 0).map(
      (l) => findAll(l, (c) => c.type === 'input')[0],
    )[0];
  const before = checkbox();
  if (!before || before.props.checked !== true) throw new Error('active checkbox not found / not checked after load');
  await before.props.onChange({ target: { checked: false } });
  await run.settle(5);
  return { active: checkbox().props.checked };
}

async function main() {
  const err = console.error;
  const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => { console.error = () => {}; try { return await fn(); } finally { console.error = err; } };

  // ===== Delete: verified none =====
  {
    const w = newWorld([ok0], [true]);
    await clickDelete(w);
    ok('delete, no future bookings: the ordinary question is asked once', w.confirms.length === 1 && w.confirms[0].message === 'Are you sure you want to delete "Castle"?');
    ok('delete, no future bookings: confirmed -> exactly one delete request', w.deleteCalls.length === 1 && w.deleteCalls[0] === 'unit-1');
    const c = newWorld([ok0], [false]);
    await clickDelete(c);
    ok('delete, no future bookings: cancelled -> no delete request', c.deleteCalls.length === 0);
  }
  // ===== Delete: one booking =====
  {
    const w = newWorld([withBookings(1)], [true]);
    await clickDelete(w);
    const m = w.confirms[0]?.message ?? '';
    ok('delete, one future booking: the WARNING names the count, the order, the customer and the date', /WARNING: "Castle" has 1 future booking\(s\)!/.test(m) && m.includes('• Order #A1B2C3D4 - Ann Lee1 on 2030-06-01') && /Deleting this unit may cause issues with these orders\. Are you sure you want to continue\?/.test(m));
    ok('delete, one future booking: confirmed -> delete request sent', w.deleteCalls.length === 1);
    const c = newWorld([withBookings(1)], [false]);
    await clickDelete(c);
    ok('delete, one future booking: cancelled -> no delete request', c.deleteCalls.length === 0);
  }
  // ===== Delete: several bookings (first five listed, the rest counted) =====
  {
    const w = newWorld([withBookings(7)], [false]);
    await clickDelete(w);
    const m = w.confirms[0]?.message ?? '';
    ok('delete, seven future bookings: count 7, five listed, "...and 2 more"', /has 7 future booking\(s\)!/.test(m) && (m.match(/• Order #/g) ?? []).length === 5 && m.includes('...and 2 more'));
  }
  // ===== Delete: the check FAILS =====
  for (const [label, lookup] of [['a database error', dbError], ['a network failure (fetch rejects)', offline]] as Array<[string, Lookup]>) {
    // The scripted Admin answers YES to the first dialog, whatever it is, and NO to the second: a screen that treated the failure as 'no bookings'
    // would take that YES as 'delete it'; the real flow takes it as 'Try again' and the NO as 'Cancel'.
    const w = newWorld([lookup], [true, false]);
    const escaped = await quiet(() => clickDelete(w));
    ok(`delete, ${label}: no exception escapes the handler`, escaped === null);
    ok(`delete, ${label}: the Admin is told the check failed and nothing was changed`, w.confirms.length >= 1 && /Could not check "Castle" for future bookings/.test(w.confirms[0].message) && /Nothing has been changed/.test(w.confirms[0].message));
    ok(`delete, ${label}: the only choices are Try again / Cancel`, w.confirms[0]?.options?.confirmText === 'Try again' && w.confirms[0]?.options?.cancelText === 'Cancel');
    ok(`delete, ${label}: NO delete request is sent`, w.deleteCalls.length === 0);
    ok(`delete, ${label}: it is not treated as "no future bookings" (the ordinary delete question is never asked)`, !w.confirms.some((c) => /Are you sure you want to delete/.test(c.message)));
  }
  // ===== Delete: failure, Try again repeatedly, never reaches the delete while unknown =====
  {
    const w = newWorld([dbError], [true, true, true, false]);
    await quiet(() => clickDelete(w));
    ok('delete, check keeps failing: Try again x3 then Cancel -> 4 lookups, 4 failure messages, no delete request', w.lookupCalls === 4 && w.confirms.length === 4 && w.confirms.every((c) => /Could not check/.test(c.message)) && w.deleteCalls.length === 0);
  }
  // ===== Delete: failure then a successful retry =====
  {
    const w = newWorld([offline, ok0], [true, true]);
    await quiet(() => clickDelete(w));
    ok('delete, retry after failure: the second lookup is made', w.lookupCalls === 2);
    ok('delete, retry after failure: a success with no bookings asks the ordinary question next', w.confirms.length === 2 && /Could not check/.test(w.confirms[0].message) && w.confirms[1].message === 'Are you sure you want to delete "Castle"?');
    ok('delete, retry after failure: confirmed -> exactly one delete request', w.deleteCalls.length === 1);
    const x = newWorld([dbError, withBookings(2)], [true, false]);
    await quiet(() => clickDelete(x));
    ok('delete, retry finds bookings: the WARNING is shown and cancelling sends no delete request', x.confirms.length === 2 && /has 2 future booking\(s\)!/.test(x.confirms[1].message) && x.deleteCalls.length === 0);
  }

  // ===== Deactivate (UnitForm Active checkbox) =====
  {
    const w = newWorld([ok0], []);
    const r = await toggleActiveOff(w);
    ok('deactivate, no future bookings: no question, the unit becomes inactive in the form', w.confirms.length === 0 && r.active === false);
  }
  {
    const w = newWorld([withBookings(2)], [true]);
    const r = await toggleActiveOff(w);
    const m = w.confirms[0]?.message ?? '';
    ok('deactivate, two future bookings: the WARNING uses the "inactive" wording', /has 2 future booking\(s\)!/.test(m) && /Marking this unit as inactive may cause issues with these orders\./.test(m));
    ok('deactivate, two future bookings: confirmed -> becomes inactive', r.active === false);
    const c = newWorld([withBookings(2)], [false]);
    ok('deactivate, two future bookings: cancelled -> stays active', (await toggleActiveOff(c)).active === true);
  }
  for (const [label, lookup] of [['a database error', dbError], ['a network failure', offline]] as Array<[string, Lookup]>) {
    const w = newWorld([lookup], [false]);
    const r = await quiet(() => toggleActiveOff(w));
    ok(`deactivate, ${label}: the unit STAYS active and the Admin gets Try again / Cancel`, r.active === true && w.confirms.length === 1 && /Could not check "Castle" for future bookings/.test(w.confirms[0].message) && /deactivating it is blocked/.test(w.confirms[0].message) && w.confirms[0].options?.confirmText === 'Try again');
  }
  {
    const w = newWorld([offline, ok0], [true]);
    const r = await quiet(() => toggleActiveOff(w));
    ok('deactivate, retry after failure succeeds with no bookings: becomes inactive after exactly one failure message', r.active === false && w.confirms.length === 1 && w.lookupCalls === 2);
  }

  console.log(`unitDeleteFlow: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} unit delete flow test(s) failed`);
}
main();
