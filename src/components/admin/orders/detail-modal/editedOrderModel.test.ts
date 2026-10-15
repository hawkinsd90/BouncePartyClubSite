// Differential characterization tests for editedOrderModel.
//
// The oracle functions below are verbatim copies of the expressions that lived
// inline in OrderDetailModal before the extraction (the initial editedOrder
// object, and the orderChanged / itemsChanged comparison inside the hasChanges
// effect). They never call the helpers. Several expectations are also
// hand-written literals so the test does not rely on the oracle alone.
//
// These tests pin CURRENT behavior, including deliberate oddities:
// - dates are normalized to date-only when building, but compared against the
//   RAW stored dates, so an order with timestamps compares as changed at once;
// - only 13 fields plus the staged-item flags are compared (can_stake, address
//   lat/lng/county, Parks, waivers and overrides are not).
// They are not a statement of desired behavior.

import { buildInitialEditedOrder, hasOrderDetailChanges } from './editedOrderModel';
import type { EditableOrderSource, EditedOrderState, StagedItemChangeFlags } from './editedOrderModel';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

// Strict structural equality: NaN equals NaN, and an own property whose value
// is undefined is different from a missing property.
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim copies of the pre-extraction inline code.
// ---------------------------------------------------------------------------

function oracleInitial(order: EditableOrderSource) {
  return {
    location_type: order.location_type,
    surface: order.surface,
    can_stake: order.surface === 'grass',
    generator_qty: order.generator_qty || 0,
    start_window: order.start_window,
    end_window: order.end_window,
    event_date: order.event_date?.split('T')[0] || order.event_date,
    event_end_date: (order.event_end_date || order.event_date)?.split('T')[0] || order.event_date,
    address_line1: order.addresses?.line1 || '',
    address_line2: order.addresses?.line2 || '',
    address_city: order.addresses?.city || '',
    address_state: order.addresses?.state || '',
    address_zip: order.addresses?.zip || '',
    pickup_preference: order.pickup_preference || 'next_day',
  };
}

function oracleDirty(
  editedOrder: EditedOrderState,
  order: EditableOrderSource,
  stagedItems: StagedItemChangeFlags[],
): boolean {
  const orderChanged =
    editedOrder.location_type !== order.location_type ||
    editedOrder.surface !== order.surface ||
    editedOrder.generator_qty !== (order.generator_qty || 0) ||
    editedOrder.start_window !== order.start_window ||
    editedOrder.end_window !== order.end_window ||
    editedOrder.event_date !== order.event_date ||
    editedOrder.event_end_date !== (order.event_end_date || order.event_date) ||
    editedOrder.address_line1 !== (order.addresses?.line1 || '') ||
    editedOrder.address_line2 !== (order.addresses?.line2 || '') ||
    editedOrder.address_city !== (order.addresses?.city || '') ||
    editedOrder.address_state !== (order.addresses?.state || '') ||
    editedOrder.address_zip !== (order.addresses?.zip || '') ||
    editedOrder.pickup_preference !== (order.pickup_preference || 'next_day');

  const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted || item.is_updated);

  return orderChanged || itemsChanged;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkOrder(over: Record<string, unknown> = {}): EditableOrderSource {
  return {
    location_type: 'residential',
    surface: 'grass',
    generator_qty: 1,
    start_window: '09:00',
    end_window: '17:00',
    event_date: '2026-10-10',
    event_end_date: '2026-10-11',
    addresses: { line1: '1 Main St', line2: 'Apt 2', city: 'Austin', state: 'TX', zip: '78701' },
    pickup_preference: 'next_day',
    ...over,
  } as unknown as EditableOrderSource;
}

// The edited state for an order, built by the ORACLE (not the helper).
function edited(order: EditableOrderSource, over: Record<string, unknown> = {}): EditedOrderState {
  return { ...oracleInitial(order), ...over } as unknown as EditedOrderState;
}

// Runs the helper and the oracle on the same input and requires identical output.
function checkInitial(label: string, order: EditableOrderSource): EditedOrderState {
  const actual = buildInitialEditedOrder(order);
  ok(`${label} [initial matches oracle]`, same(actual, oracleInitial(order)));
  return actual;
}

function checkDirty(
  label: string,
  editedOrder: EditedOrderState,
  order: EditableOrderSource,
  stagedItems: StagedItemChangeFlags[] = [],
): boolean {
  const actual = hasOrderDetailChanges(editedOrder, order, stagedItems);
  ok(`${label} [dirty matches oracle]`, actual === oracleDirty(editedOrder, order, stagedItems));
  return actual;
}

// ---------------------------------------------------------------------------
// buildInitialEditedOrder
// ---------------------------------------------------------------------------

// 1. Standard date-only order, against a hand-written literal.
const standard = checkInitial('standard', mkOrder());
ok('standard order builds the expected literal', same(standard, {
  location_type: 'residential',
  surface: 'grass',
  can_stake: true,
  generator_qty: 1,
  start_window: '09:00',
  end_window: '17:00',
  event_date: '2026-10-10',
  event_end_date: '2026-10-11',
  address_line1: '1 Main St',
  address_line2: 'Apt 2',
  address_city: 'Austin',
  address_state: 'TX',
  address_zip: '78701',
  pickup_preference: 'next_day',
}));

// 2-3. Timestamps become date-only.
ok('event_date with a timestamp becomes date-only',
  checkInitial('ts event_date', mkOrder({ event_date: '2026-10-10T00:00:00+00:00' })).event_date === '2026-10-10');
ok('event_end_date with a timestamp becomes date-only',
  checkInitial('ts event_end_date', mkOrder({ event_end_date: '2026-10-11T18:30:00Z' })).event_end_date === '2026-10-11');

// 4. Missing event_end_date falls back to event_date (and is normalized too).
ok('missing event_end_date falls back to event_date',
  checkInitial('no end', mkOrder({ event_end_date: undefined })).event_end_date === '2026-10-10');
ok('null event_end_date falls back to event_date',
  checkInitial('null end', mkOrder({ event_end_date: null })).event_end_date === '2026-10-10');
ok('fallback end date is normalized to date-only',
  checkInitial('no end + ts', mkOrder({ event_date: '2026-10-10T08:00:00', event_end_date: undefined })).event_end_date === '2026-10-10');
const noDates = checkInitial('no dates', mkOrder({ event_date: undefined, event_end_date: undefined }));
ok('no event_date leaves both dates undefined', noDates.event_date === undefined && noDates.event_end_date === undefined);
ok('null event_date stays null', checkInitial('null date', mkOrder({ event_date: null, event_end_date: undefined })).event_date === null);

// 5-6. Address defaults.
const noAddress = checkInitial('no addresses', mkOrder({ addresses: undefined }));
ok('missing address object gives empty strings',
  noAddress.address_line1 === '' && noAddress.address_line2 === '' && noAddress.address_city === '' && noAddress.address_state === '' && noAddress.address_zip === '');
const nullAddress = checkInitial('null addresses', mkOrder({ addresses: null }));
ok('null address object gives empty strings', nullAddress.address_line1 === '' && nullAddress.address_zip === '');
const partialAddress = checkInitial('partial address', mkOrder({ addresses: { line1: '9 Oak', city: null } }));
ok('missing individual address fields give empty strings',
  partialAddress.address_line1 === '9 Oak' && partialAddress.address_line2 === '' && partialAddress.address_city === '' && partialAddress.address_state === '' && partialAddress.address_zip === '');

// 7-8. can_stake.
ok('grass surface gives can_stake true', checkInitial('grass', mkOrder({ surface: 'grass' })).can_stake === true);
ok('cement surface gives can_stake false', checkInitial('cement', mkOrder({ surface: 'cement' })).can_stake === false);
ok('missing surface gives can_stake false', checkInitial('no surface', mkOrder({ surface: undefined })).can_stake === false);

// 9-10. generator_qty.
ok('numeric generator_qty is kept', checkInitial('gen 3', mkOrder({ generator_qty: 3 })).generator_qty === 3);
ok('null generator_qty becomes 0', checkInitial('gen null', mkOrder({ generator_qty: null })).generator_qty === 0);
ok('undefined generator_qty becomes 0', checkInitial('gen undefined', mkOrder({ generator_qty: undefined })).generator_qty === 0);
ok('zero generator_qty stays 0', checkInitial('gen 0', mkOrder({ generator_qty: 0 })).generator_qty === 0);

// 11-12. pickup_preference.
ok('present pickup_preference is kept', checkInitial('pickup', mkOrder({ pickup_preference: 'same_day' })).pickup_preference === 'same_day');
ok('missing pickup_preference becomes next_day', checkInitial('no pickup', mkOrder({ pickup_preference: undefined })).pickup_preference === 'next_day');
ok('null pickup_preference becomes next_day', checkInitial('null pickup', mkOrder({ pickup_preference: null })).pickup_preference === 'next_day');
ok('empty pickup_preference becomes next_day', checkInitial('empty pickup', mkOrder({ pickup_preference: '' })).pickup_preference === 'next_day');

// 13. Raw passthrough of windows and location.
const windows = checkInitial('windows', mkOrder({ start_window: '08:15', end_window: '20:45', location_type: 'commercial' }));
ok('start and end windows pass through raw', windows.start_window === '08:15' && windows.end_window === '20:45');
ok('location_type passes through raw', windows.location_type === 'commercial');
const noWindows = checkInitial('no windows', mkOrder({ start_window: undefined, end_window: null }));
ok('undefined and null windows pass through unchanged', noWindows.start_window === undefined && noWindows.end_window === null);

// 14. Exact key set (14 keys; no lat/lng/county, Parks, fees or pricing).
const EXPECTED_INITIAL_KEYS = [
  'location_type', 'surface', 'can_stake', 'generator_qty', 'start_window', 'end_window',
  'event_date', 'event_end_date', 'address_line1', 'address_line2', 'address_city',
  'address_state', 'address_zip', 'pickup_preference',
].sort();
ok('initial state has exactly the expected 14 keys', same(Object.keys(standard).sort(), EXPECTED_INITIAL_KEYS));
ok('initial state keys are present even when the source value is undefined',
  same(Object.keys(noDates).sort(), EXPECTED_INITIAL_KEYS));

// ---------------------------------------------------------------------------
// hasOrderDetailChanges
// ---------------------------------------------------------------------------

const base = mkOrder();
const baseEdited = edited(base);

// 14. No changes.
ok('unchanged state is not dirty', checkDirty('unchanged', baseEdited, base) === false);

// 1-13. Each compared field, independently.
const FIELD_FLIPS: Array<[string, unknown]> = [
  ['location_type', 'commercial'],
  ['surface', 'cement'],
  ['generator_qty', 2],
  ['start_window', '10:00'],
  ['end_window', '18:00'],
  ['event_date', '2026-10-12'],
  ['event_end_date', '2026-10-13'],
  ['address_line1', '2 Main St'],
  ['address_line2', 'Apt 3'],
  ['address_city', 'Dallas'],
  ['address_state', 'OK'],
  ['address_zip', '75001'],
  ['pickup_preference', 'same_day'],
];
for (const [field, value] of FIELD_FLIPS) {
  ok(`changing ${field} makes the state dirty`, checkDirty(`flip ${field}`, edited(base, { [field]: value }), base) === true);
}
// Setting each field back to its original value is clean again.
for (const [field] of FIELD_FLIPS) {
  const original = (baseEdited as unknown as Record<string, unknown>)[field];
  ok(`restoring ${field} is clean again`, checkDirty(`restore ${field}`, edited(base, { [field]: original }), base) === false);
}

// Staged items.
ok('is_new staged item is dirty', checkDirty('is_new', baseEdited, base, [{ is_new: true }]) === true);
ok('is_deleted staged item is dirty', checkDirty('is_deleted', baseEdited, base, [{ is_deleted: true }]) === true);
ok('is_updated staged item is dirty', checkDirty('is_updated', baseEdited, base, [{ is_updated: true }]) === true);
ok('staged item with all flags false is clean',
  checkDirty('flags false', baseEdited, base, [{ is_new: false, is_deleted: false, is_updated: false }]) === false);
ok('staged item with all flags undefined is clean', checkDirty('flags undefined', baseEdited, base, [{}]) === false);
ok('one flagged item among clean ones is dirty',
  checkDirty('mixed items', baseEdited, base, [{}, { is_new: false }, { is_updated: true }]) === true);
ok('empty staged list is clean', checkDirty('no items', baseEdited, base, []) === false);

// Fallbacks on the stored order.
const noGen = mkOrder({ generator_qty: null });
ok('null stored generator_qty compares as 0 (clean)', checkDirty('gen null clean', edited(noGen), noGen) === false);
ok('null stored generator_qty vs edited 1 is dirty', checkDirty('gen null dirty', edited(noGen, { generator_qty: 1 }), noGen) === true);
const undefGen = mkOrder({ generator_qty: undefined });
ok('undefined stored generator_qty compares as 0 (clean)', checkDirty('gen undef clean', edited(undefGen), undefGen) === false);

const noAddr = mkOrder({ addresses: undefined });
ok('missing stored address compares as empty strings (clean)', checkDirty('addr clean', edited(noAddr), noAddr) === false);
ok('missing stored address vs edited text is dirty', checkDirty('addr dirty', edited(noAddr, { address_line1: 'x' }), noAddr) === true);
const partialAddr = mkOrder({ addresses: { line1: '9 Oak' } });
ok('partial stored address uses empty-string fallback per field (clean)', checkDirty('partial addr', edited(partialAddr), partialAddr) === false);

const noPickup = mkOrder({ pickup_preference: undefined });
ok('missing stored pickup_preference compares as next_day (clean)', checkDirty('pickup clean', edited(noPickup), noPickup) === false);
ok('missing stored pickup_preference vs same_day is dirty', checkDirty('pickup dirty', edited(noPickup, { pickup_preference: 'same_day' }), noPickup) === true);

const noEnd = mkOrder({ event_end_date: undefined });
ok('missing stored event_end_date compares against event_date (clean)', checkDirty('end clean', edited(noEnd), noEnd) === false);
ok('missing stored event_end_date vs a different end date is dirty', checkDirty('end dirty', edited(noEnd, { event_end_date: '2026-10-11' }), noEnd) === true);

// Fields that are deliberately NOT compared.
ok('can_stake is not compared', checkDirty('can_stake', edited(base, { can_stake: false }), base) === false);
ok('address lat/lng/county are not compared',
  checkDirty('geo', edited(base, { address_lat: 1, address_lng: 2, address_county: 'Travis' }), base) === false);
ok('unrelated extra state (waivers, deposits, Parks) is not compared',
  checkDirty('extras', edited(base, { taxWaived: true, custom_deposit_cents: 5, parks_acknowledgment_required: true }), base) === false);

// ---------------------------------------------------------------------------
// Existing date quirk: build normalizes to date-only, compare uses RAW dates.
// This pins the CURRENT behavior; it is not a fix.
// ---------------------------------------------------------------------------

const tsBoth = mkOrder({ event_date: '2026-10-10T00:00:00+00:00', event_end_date: '2026-10-11T00:00:00+00:00' });
const tsBothInitial = buildInitialEditedOrder(tsBoth);
ok('timestamp order: initial event_date is date-only', tsBothInitial.event_date === '2026-10-10');
ok('timestamp order: initial event_end_date is date-only', tsBothInitial.event_end_date === '2026-10-11');
ok('timestamp order appears dirty immediately (raw dates are compared)',
  checkDirty('quirk both', tsBothInitial, tsBoth) === true);

const tsEndOnly = mkOrder({ event_end_date: '2026-10-11T18:30:00Z' });
ok('only a timestamped event_end_date also appears dirty immediately',
  checkDirty('quirk end only', buildInitialEditedOrder(tsEndOnly), tsEndOnly) === true);

const tsStartOnly = mkOrder({ event_date: '2026-10-10T08:00:00', event_end_date: '2026-10-11' });
ok('only a timestamped event_date also appears dirty immediately',
  checkDirty('quirk start only', buildInitialEditedOrder(tsStartOnly), tsStartOnly) === true);

const tsFallback = mkOrder({ event_date: '2026-10-10T08:00:00', event_end_date: undefined });
ok('missing end date with a timestamped event_date appears dirty immediately',
  checkDirty('quirk fallback', buildInitialEditedOrder(tsFallback), tsFallback) === true);

// ---------------------------------------------------------------------------
// Invariant: an ordinary order (date-only dates) built then compared is clean.
// ---------------------------------------------------------------------------

const ORDINARY_ORDERS: Array<[string, EditableOrderSource]> = [
  ['full order', mkOrder()],
  ['no address', mkOrder({ addresses: undefined })],
  ['null address', mkOrder({ addresses: null })],
  ['partial address', mkOrder({ addresses: { line1: '9 Oak' } })],
  ['no pickup', mkOrder({ pickup_preference: undefined })],
  ['no generator qty', mkOrder({ generator_qty: undefined })],
  ['no end date', mkOrder({ event_end_date: undefined })],
  ['no windows', mkOrder({ start_window: undefined, end_window: undefined })],
  ['cement surface', mkOrder({ surface: 'cement' })],
  ['no dates at all', mkOrder({ event_date: undefined, event_end_date: undefined })],
];
for (const [label, order] of ORDINARY_ORDERS) {
  ok(`invariant: build then compare is clean (${label})`,
    hasOrderDetailChanges(buildInitialEditedOrder(order), order, []) === false);
}
ok('invariant spelled out for the standard order: hasOrderDetailChanges(buildInitialEditedOrder(order), order, []) === false',
  hasOrderDetailChanges(buildInitialEditedOrder(base), base, []) === false);

// ---------------------------------------------------------------------------
// The comparison helpers themselves
// ---------------------------------------------------------------------------

ok('same() treats { a: undefined } and {} as different', !same({ a: undefined }, {}));
ok('same() treats NaN as equal to NaN', same(NaN, NaN));
ok('same() treats different values as different', !same({ a: 1 }, { a: 2 }));

console.log(`\nEdited order model tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} edited order model test(s) failed`);
