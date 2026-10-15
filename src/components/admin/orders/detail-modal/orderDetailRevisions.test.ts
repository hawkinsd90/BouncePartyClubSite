// Characterization tests for orderDetailRevisions.
//
// The oracle functions below are verbatim copies of the JSON.stringify objects that
// lived inline in OrderDetailModal's `currentPricingRevision` and
// `currentGeneratorContextRevision` memos before the extraction. They never call
// the builders. Hand-written literal strings are also asserted, so the tests do not
// rely on the oracle alone.
//
// The revisions are STRINGS compared for equality, so these tests compare exact
// strings: property order, array order, null / undefined handling and the JSON of
// component snapshots are all part of the contract. Nothing is sorted or hashed.

import { buildOrderDetailPricingRevision, buildGeneratorContextRevision } from './orderDetailRevisions';
import type {
  OrderDetailPricingRevisionInput,
  GeneratorContextRevisionInput,
} from './orderDetailRevisions';
import type { StagedItem } from './stagedItemModel';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim copies of the pre-extraction inline JSON.stringify objects.
// ---------------------------------------------------------------------------

function oraclePricing(p: OrderDetailPricingRevisionInput): string {
  const {
    stagedItems, discounts, customFees, customDepositCents, customSetupFeeCents, editedOrder,
    taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived,
    sameDayWeekdayDeliveryFeeWaived, pricingRules,
  } = p;
  return JSON.stringify({
    stagedItems: stagedItems.map(i => ({
      unit_id: i.unit_id, product_id: i.product_id, bundle_id: i.bundle_id,
      qty: i.qty, wet_or_dry: i.wet_or_dry, unit_price_cents: i.unit_price_cents,
      pricing_context: i.pricing_context, component_snapshot: i.component_snapshot,
      is_new: i.is_new, is_deleted: i.is_deleted, is_updated: i.is_updated,
    })),
    discounts: discounts.map((d) => ({ id: d.id, amount_cents: d.amount_cents, percentage: d.percentage, is_new: d.is_new })),
    customFees: customFees.map((f) => ({ id: f.id, amount_cents: f.amount_cents, is_new: f.is_new })),
    customDepositCents,
    customSetupFeeCents,
    location_type: editedOrder.location_type,
    surface: editedOrder.surface,
    generator_qty: editedOrder.generator_qty,
    address_line1: editedOrder.address_line1,
    address_city: editedOrder.address_city,
    address_state: editedOrder.address_state,
    address_zip: editedOrder.address_zip,
    pickup_preference: editedOrder.pickup_preference,
    event_date: editedOrder.event_date,
    event_end_date: editedOrder.event_end_date,
    taxWaived,
    travelFeeWaived,
    sameDayPickupFeeWaived,
    surfaceFeeWaived,
    generatorFeeWaived,
    sameDayWeekdayDeliveryFeeWaived,
    pricingRules: pricingRules ?? null,
  });
}

function oracleGenerator(g: GeneratorContextRevisionInput): string {
  const { stagedItems, eventDate, eventEndDate, generatorQty, generatorFeeWaived } = g;
  return JSON.stringify({
    stagedItems: stagedItems.map(i => ({
      unit_id: i.unit_id, product_id: i.product_id, bundle_id: i.bundle_id,
      qty: i.qty, wet_or_dry: i.wet_or_dry, unit_price_cents: i.unit_price_cents,
      pricing_context: i.pricing_context, component_snapshot: i.component_snapshot,
      is_deleted: i.is_deleted,
    })),
    event_date: eventDate,
    event_end_date: eventEndDate,
    generator_qty: generatorQty,
    generatorFeeWaived,
  });
}

// ---------------------------------------------------------------------------
// Fixtures and check helpers
// ---------------------------------------------------------------------------

const st = (over: Record<string, unknown> = {}) => ({ qty: 1, unit_price_cents: 5000, ...over }) as unknown as StagedItem;
const SNAP = { bundle_name: 'Party Pack', bundle_description: null, components: [{ product_id: 'p1', product_name: 'Chair', quantity_per_bundle: 4 }] };

const INFLATABLE = st({ id: 'i1', unit_id: 'u1', unit_name: 'Castle', qty: 1, wet_or_dry: 'dry', unit_price_cents: 20000, is_new: false, is_deleted: false });
const EE_PRODUCT = st({ id: 'i2', product_id: 'p1', product_name: 'Chair', qty: 4, unit_price_cents: 250, pricing_context: 'standalone', component_snapshot: null, is_new: false, is_deleted: false });
const EE_BUNDLE = st({ client_id: 'c3', bundle_id: 'b1', item_name: 'Party Pack', qty: 1, unit_price_cents: 9000, pricing_context: 'addon', component_snapshot: SNAP, is_new: true, is_deleted: false });

const EDITED = {
  location_type: 'residential', surface: 'grass', generator_qty: 1,
  address_line1: '1 Main St', address_city: 'Austin', address_state: 'TX', address_zip: '78701',
  pickup_preference: 'next_day', event_date: '2026-10-10', event_end_date: '2026-10-11',
};

function pricingInput(over: Record<string, unknown> = {}): OrderDetailPricingRevisionInput {
  return {
    stagedItems: [INFLATABLE, EE_PRODUCT, EE_BUNDLE],
    discounts: [{ id: 'd1', amount_cents: 500, percentage: undefined, is_new: false }, { id: 'd2', amount_cents: undefined, percentage: 10, is_new: true }],
    customFees: [{ id: 'f1', amount_cents: 300, is_new: false }],
    customDepositCents: null,
    customSetupFeeCents: null,
    editedOrder: { ...EDITED },
    taxWaived: false, travelFeeWaived: false, sameDayPickupFeeWaived: false,
    surfaceFeeWaived: false, generatorFeeWaived: false, sameDayWeekdayDeliveryFeeWaived: false,
    pricingRules: { travel: { base: 10, perMile: 2 } },
    ...over,
  } as unknown as OrderDetailPricingRevisionInput;
}
const editedWith = (over: Record<string, unknown>) => ({ ...EDITED, ...over });

function generatorInput(over: Record<string, unknown> = {}): GeneratorContextRevisionInput {
  return {
    stagedItems: [INFLATABLE, EE_PRODUCT, EE_BUNDLE],
    eventDate: '2026-10-10', eventEndDate: '2026-10-11', generatorQty: 1, generatorFeeWaived: false,
    ...over,
  } as GeneratorContextRevisionInput;
}

// helper === oracle for one input; returns the helper string.
const P = (label: string, input: OrderDetailPricingRevisionInput): string => {
  const actual = buildOrderDetailPricingRevision(input);
  ok(`pricing: ${label} [exact string matches oracle]`, actual === oraclePricing(input));
  return actual;
};
const G = (label: string, input: GeneratorContextRevisionInput): string => {
  const actual = buildGeneratorContextRevision(input);
  ok(`generator: ${label} [exact string matches oracle]`, actual === oracleGenerator(input));
  return actual;
};
const pricingDiffers = (label: string, over: Record<string, unknown>) =>
  ok(`pricing: ${label} changes the revision`, P(label, pricingInput()) !== P(`${label} (variant)`, pricingInput(over)));
const generatorDiffers = (label: string, over: Record<string, unknown>) =>
  ok(`generator: ${label} changes the revision`, G(label, generatorInput()) !== G(`${label} (variant)`, generatorInput(over)));
const generatorSame = (label: string, over: Record<string, unknown>) =>
  ok(`generator: ${label} does NOT change the revision`, G(label, generatorInput()) === G(`${label} (variant)`, generatorInput(over)));

// ===========================================================================
// PRICING REVISION
// ===========================================================================

// Representative order + exact hand-written literals.
P('representative order', pricingInput());
ok('pricing: minimal literal string (property order pinned)', P('minimal', pricingInput({ stagedItems: [], discounts: [], customFees: [] })) ===
  '{"stagedItems":[],"discounts":[],"customFees":[],"customDepositCents":null,"customSetupFeeCents":null,'
  + '"location_type":"residential","surface":"grass","generator_qty":1,"address_line1":"1 Main St","address_city":"Austin",'
  + '"address_state":"TX","address_zip":"78701","pickup_preference":"next_day","event_date":"2026-10-10","event_end_date":"2026-10-11",'
  + '"taxWaived":false,"travelFeeWaived":false,"sameDayPickupFeeWaived":false,"surfaceFeeWaived":false,"generatorFeeWaived":false,'
  + '"sameDayWeekdayDeliveryFeeWaived":false,"pricingRules":{"travel":{"base":10,"perMile":2}}}');
ok('pricing: one inflatable staged item literal (undefined fields omitted, order kept)', P('inflatable literal', pricingInput({ stagedItems: [
  st({ unit_id: 'u1', qty: 2, wet_or_dry: 'dry', unit_price_cents: 5000, is_new: true }),
], discounts: [], customFees: [], pricingRules: null })).startsWith(
  '{"stagedItems":[{"unit_id":"u1","qty":2,"wet_or_dry":"dry","unit_price_cents":5000,"is_new":true}],"discounts":[],'));
ok('pricing: staged item with all three flags literal', P('flags literal', pricingInput({ stagedItems: [
  st({ product_id: 'p1', is_new: true, is_deleted: false, is_updated: true }),
], discounts: [], customFees: [] })).startsWith(
  '{"stagedItems":[{"product_id":"p1","qty":1,"unit_price_cents":5000,"is_new":true,"is_deleted":false,"is_updated":true}],'));
ok('pricing: component snapshot is serialized as nested JSON in its own key order', P('snapshot literal', pricingInput({ stagedItems: [
  st({ bundle_id: 'b1', component_snapshot: SNAP }),
], discounts: [], customFees: [] })).includes(
  '"component_snapshot":{"bundle_name":"Party Pack","bundle_description":null,"components":[{"product_id":"p1","product_name":"Chair","quantity_per_bundle":4}]}'));
ok('pricing: discount and fee projection literal', P('discount literal', pricingInput({ stagedItems: [], discounts: [{ id: 'd1', amount_cents: 500, percentage: 10, is_new: true }], customFees: [{ id: 'f1', amount_cents: 300, is_new: false }] })).includes(
  '"discounts":[{"id":"d1","amount_cents":500,"percentage":10,"is_new":true}],"customFees":[{"id":"f1","amount_cents":300,"is_new":false}]'));

// Empty staged items, and the three row kinds.
pricingDiffers('removing all staged items', { stagedItems: [] });
P('empty everything', pricingInput({ stagedItems: [], discounts: [], customFees: [], pricingRules: null }));
P('inflatable only', pricingInput({ stagedItems: [INFLATABLE] }));
P('EE product only', pricingInput({ stagedItems: [EE_PRODUCT] }));
P('EE bundle with snapshot only', pricingInput({ stagedItems: [EE_BUNDLE] }));

// Staged-item flags each matter for pricing.
pricingDiffers('staged is_new', { stagedItems: [{ ...INFLATABLE, is_new: true }, EE_PRODUCT, EE_BUNDLE] });
pricingDiffers('staged is_deleted', { stagedItems: [{ ...INFLATABLE, is_deleted: true }, EE_PRODUCT, EE_BUNDLE] });
pricingDiffers('staged is_updated', { stagedItems: [{ ...INFLATABLE, is_updated: true }, EE_PRODUCT, EE_BUNDLE] });
pricingDiffers('staged item order', { stagedItems: [EE_PRODUCT, INFLATABLE, EE_BUNDLE] });
pricingDiffers('staged qty', { stagedItems: [{ ...INFLATABLE, qty: 2 }, EE_PRODUCT, EE_BUNDLE] });
pricingDiffers('staged unit_price_cents', { stagedItems: [{ ...INFLATABLE, unit_price_cents: 21000 }, EE_PRODUCT, EE_BUNDLE] });
pricingDiffers('staged pricing_context', { stagedItems: [INFLATABLE, { ...EE_PRODUCT, pricing_context: 'addon' }, EE_BUNDLE] });
pricingDiffers('staged wet_or_dry', { stagedItems: [{ ...INFLATABLE, wet_or_dry: 'water' }, EE_PRODUCT, EE_BUNDLE] });
pricingDiffers('staged unit_id', { stagedItems: [{ ...INFLATABLE, unit_id: 'u2' }, EE_PRODUCT, EE_BUNDLE] });
pricingDiffers('staged product_id', { stagedItems: [INFLATABLE, { ...EE_PRODUCT, product_id: 'p2' }, EE_BUNDLE] });
pricingDiffers('staged bundle_id', { stagedItems: [INFLATABLE, EE_PRODUCT, { ...EE_BUNDLE, bundle_id: 'b2' }] });
pricingDiffers('staged component_snapshot', { stagedItems: [INFLATABLE, EE_PRODUCT, { ...EE_BUNDLE, component_snapshot: { ...SNAP, bundle_name: 'Other' } }] });

// Discounts and fees.
pricingDiffers('discount amount', { discounts: [{ id: 'd1', amount_cents: 600, percentage: undefined, is_new: false }, { id: 'd2', amount_cents: undefined, percentage: 10, is_new: true }] });
pricingDiffers('discount percentage', { discounts: [{ id: 'd1', amount_cents: 500, percentage: undefined, is_new: false }, { id: 'd2', amount_cents: undefined, percentage: 15, is_new: true }] });
pricingDiffers('discount is_new', { discounts: [{ id: 'd1', amount_cents: 500, percentage: undefined, is_new: true }, { id: 'd2', amount_cents: undefined, percentage: 10, is_new: true }] });
pricingDiffers('discount id', { discounts: [{ id: 'dX', amount_cents: 500, percentage: undefined, is_new: false }, { id: 'd2', amount_cents: undefined, percentage: 10, is_new: true }] });
pricingDiffers('fee amount', { customFees: [{ id: 'f1', amount_cents: 400, is_new: false }] });
pricingDiffers('fee is_new', { customFees: [{ id: 'f1', amount_cents: 300, is_new: true }] });
pricingDiffers('fee id', { customFees: [{ id: 'fX', amount_cents: 300, is_new: false }] });
pricingDiffers('discount order', { discounts: [{ id: 'd2', amount_cents: undefined, percentage: 10, is_new: true }, { id: 'd1', amount_cents: 500, percentage: undefined, is_new: false }] });

// Overrides: null / zero / positive are all distinct.
{
  const d = [null, 0, 2500].map((v) => P(`custom deposit ${v}`, pricingInput({ customDepositCents: v })));
  ok('pricing: custom deposit null, 0 and positive are three distinct revisions', new Set(d).size === 3);
  const s = [null, 0, 1500].map((v) => P(`custom setup fee ${v}`, pricingInput({ customSetupFeeCents: v })));
  ok('pricing: custom setup fee null, 0 and positive are three distinct revisions', new Set(s).size === 3);
  ok('pricing: deposit 0 serializes as 0, not null', d[1].includes('"customDepositCents":0,'));
}

// Each edited-order field individually.
for (const [field, value] of [
  ['location_type', 'commercial'], ['surface', 'cement'], ['generator_qty', 2], ['address_line1', '2 Main St'],
  ['address_city', 'Dallas'], ['address_state', 'OK'], ['address_zip', '75001'], ['pickup_preference', 'same_day'],
  ['event_date', '2026-10-12'], ['event_end_date', '2026-10-13'],
] as Array<[string, unknown]>) {
  pricingDiffers(`edited-order ${field}`, { editedOrder: editedWith({ [field]: value }) });
}

// Each waiver individually.
for (const w of ['taxWaived', 'travelFeeWaived', 'sameDayPickupFeeWaived', 'surfaceFeeWaived', 'generatorFeeWaived', 'sameDayWeekdayDeliveryFeeWaived']) {
  pricingDiffers(`waiver ${w}`, { [w]: true });
}

// pricingRules: object, null, undefined (?? null), key order not canonicalized.
{
  const obj = P('pricingRules object', pricingInput());
  const nul = P('pricingRules null', pricingInput({ pricingRules: null }));
  const und = P('pricingRules undefined', pricingInput({ pricingRules: undefined }));
  ok('pricing: pricingRules null serializes as "pricingRules":null', nul.endsWith('"pricingRules":null}'));
  ok('pricing: pricingRules undefined serializes exactly like null (?? null)', und === nul);
  ok('pricing: a rules object differs from null', obj !== nul);
  pricingDiffers('pricingRules content', { pricingRules: { travel: { base: 11, perMile: 2 } } });
  pricingDiffers('pricingRules key order (no canonicalization)', { pricingRules: { travel: { perMile: 2, base: 10 } } });
  ok('pricing: a falsy non-null pricingRules value is kept (0 stays 0, not null)', P('pricingRules 0', pricingInput({ pricingRules: 0 })).endsWith('"pricingRules":0}'));
}

// Fields that must NOT affect the pricing revision (passed as extras at runtime).
{
  const base = P('base for exclusions', pricingInput());
  const withExtras = P('editedOrder extras', pricingInput({
    editedOrder: editedWith({ address_line2: 'Apt 9', can_stake: false, address_lat: 1, address_lng: 2, address_county: 'Travis', start_window: '10:00', end_window: '20:00' }),
  }));
  ok('pricing: address_line2, can_stake, lat/lng/county and windows do not affect the revision', base === withExtras);
  const withInputExtras = P('input extras', pricingInput({
    adminMessage: 'hello', taxWaiveReason: 'why', travelFeeWaiveReason: 'why', surfaceFeeWaiveReason: 'why',
    generatorFeeWaiveReason: 'why', sameDayPickupFeeWaiveReason: 'why', sameDayWeekdayDeliveryFeeWaiveReason: 'why',
    requireCardOnFile: false, depositCatchupMode: 'waive',
  }));
  ok('pricing: admin message, waiver reasons, require-card-on-file and catch-up mode do not affect the revision', base === withInputExtras);
  const rowExtras = P('row extras', pricingInput({
    stagedItems: [{ ...INFLATABLE, id: 'changed', client_id: 'changed', unit_name: 'Other name', created_at: '2000-01-01', item_name: 'x', product_name: 'y' }, EE_PRODUCT, EE_BUNDLE],
    discounts: [{ id: 'd1', amount_cents: 500, percentage: undefined, is_new: false, name: 'renamed' }, { id: 'd2', amount_cents: undefined, percentage: 10, is_new: true, name: 'renamed' }],
    customFees: [{ id: 'f1', amount_cents: 300, is_new: false, name: 'renamed' }],
  }));
  ok('pricing: unlisted staged-item, discount and fee fields (id excluded for staged rows, names, timestamps) do not affect the revision', base === rowExtras);
}

// undefined vs null semantics and determinism.
{
  const u = P('undefined deposit', pricingInput({ customDepositCents: undefined }));
  ok('pricing: an undefined customDepositCents key is omitted by JSON (not serialized as null)', !u.includes('customDepositCents'));
  ok('pricing: a null component_snapshot is kept as null', P('null snapshot', pricingInput({ stagedItems: [st({ bundle_id: 'b', component_snapshot: null })], discounts: [], customFees: [] })).includes('"component_snapshot":null'));
  ok('pricing: an undefined component_snapshot is omitted', !P('undef snapshot', pricingInput({ stagedItems: [st({ bundle_id: 'b' })], discounts: [], customFees: [] })).includes('component_snapshot'));
  ok('pricing: the same input always yields the same string', P('d1', pricingInput()) === P('d2', pricingInput()));
  ok('pricing: the result is a string, not an object', typeof P('type', pricingInput()) === 'string');
}

// ===========================================================================
// GENERATOR CONTEXT REVISION
// ===========================================================================

G('representative state', generatorInput());
ok('generator: minimal literal string (property order pinned)', G('minimal', generatorInput({ stagedItems: [] })) ===
  '{"stagedItems":[],"event_date":"2026-10-10","event_end_date":"2026-10-11","generator_qty":1,"generatorFeeWaived":false}');
ok('generator: one staged item literal (is_deleted kept, is_new / is_updated absent)', G('item literal', generatorInput({ stagedItems: [
  st({ product_id: 'gen1', qty: 2, unit_price_cents: 5000, pricing_context: 'standalone', is_new: true, is_deleted: false, is_updated: true }),
] })) ===
  '{"stagedItems":[{"product_id":"gen1","qty":2,"unit_price_cents":5000,"pricing_context":"standalone","is_deleted":false}],'
  + '"event_date":"2026-10-10","event_end_date":"2026-10-11","generator_qty":1,"generatorFeeWaived":false}');
ok('generator: component snapshot literal', G('snapshot literal', generatorInput({ stagedItems: [st({ bundle_id: 'b1', component_snapshot: SNAP })] })).includes(
  '"component_snapshot":{"bundle_name":"Party Pack","bundle_description":null,"components":[{"product_id":"p1","product_name":"Chair","quantity_per_bundle":4}]}'));

G('empty staged items', generatorInput({ stagedItems: [] }));
generatorDiffers('removing all staged items', { stagedItems: [] });
generatorDiffers('staged item order', { stagedItems: [EE_PRODUCT, INFLATABLE, EE_BUNDLE] });
generatorDiffers('staged qty', { stagedItems: [{ ...INFLATABLE, qty: 3 }, EE_PRODUCT, EE_BUNDLE] });
generatorDiffers('staged unit_price_cents', { stagedItems: [{ ...INFLATABLE, unit_price_cents: 1 }, EE_PRODUCT, EE_BUNDLE] });
generatorDiffers('staged wet_or_dry (mode)', { stagedItems: [{ ...INFLATABLE, wet_or_dry: 'water' }, EE_PRODUCT, EE_BUNDLE] });
generatorDiffers('staged pricing_context', { stagedItems: [INFLATABLE, { ...EE_PRODUCT, pricing_context: 'addon' }, EE_BUNDLE] });
generatorDiffers('staged component_snapshot', { stagedItems: [INFLATABLE, EE_PRODUCT, { ...EE_BUNDLE, component_snapshot: { ...SNAP, bundle_name: 'Other' } }] });
generatorDiffers('staged is_deleted', { stagedItems: [{ ...INFLATABLE, is_deleted: true }, EE_PRODUCT, EE_BUNDLE] });
generatorDiffers('staged unit_id', { stagedItems: [{ ...INFLATABLE, unit_id: 'u2' }, EE_PRODUCT, EE_BUNDLE] });
generatorDiffers('staged product_id', { stagedItems: [INFLATABLE, { ...EE_PRODUCT, product_id: 'p2' }, EE_BUNDLE] });
generatorDiffers('staged bundle_id', { stagedItems: [INFLATABLE, EE_PRODUCT, { ...EE_BUNDLE, bundle_id: 'b2' }] });
generatorDiffers('event date', { eventDate: '2026-10-12' });
generatorDiffers('event end date', { eventEndDate: '2026-10-13' });
generatorDiffers('Generator qty', { generatorQty: 2 });
generatorDiffers('Generator fee waiver', { generatorFeeWaived: true });

// is_new / is_updated are deliberately NOT part of the Generator revision, but they ARE part of the pricing revision.
{
  const flagged = (flag: 'is_new' | 'is_updated') => [{ ...INFLATABLE, [flag]: true }, EE_PRODUCT, EE_BUNDLE];
  generatorSame('staged is_new alone', { stagedItems: flagged('is_new') });
  generatorSame('staged is_updated alone', { stagedItems: flagged('is_updated') });
  ok('pricing DOES change for is_new alone (contrast with the Generator revision)',
    P('pricing base', pricingInput()) !== P('pricing is_new', pricingInput({ stagedItems: flagged('is_new') })));
  ok('pricing DOES change for is_updated alone (contrast with the Generator revision)',
    P('pricing base 2', pricingInput()) !== P('pricing is_updated', pricingInput({ stagedItems: flagged('is_updated') })));
}

// Fields that must NOT affect the Generator revision.
{
  const base = G('generator base', generatorInput());
  const rowExtras = G('row extras', generatorInput({
    stagedItems: [{ ...INFLATABLE, id: 'changed', client_id: 'changed', unit_name: 'Other', created_at: '2000-01-01', item_name: 'x', product_name: 'y', is_new: true, is_updated: true }, EE_PRODUCT, EE_BUNDLE],
  }));
  ok('generator: unlisted staged-item fields do not affect the revision', base === rowExtras);
  const inputExtras = G('input extras', generatorInput({ discounts: [{ id: 'x' }], customFees: [], customDepositCents: 5, taxWaived: true, pricingRules: { a: 1 } }));
  ok('generator: discounts, fees, overrides, other waivers and rules do not affect the revision', base === inputExtras);
}

// Determinism and type.
ok('generator: the same input always yields the same string', G('g1', generatorInput()) === G('g2', generatorInput()));
ok('generator: undefined scalar inputs are omitted by JSON', !G('undef generator qty', generatorInput({ generatorQty: undefined })).includes('generator_qty'));
ok('generator: null scalar inputs are kept', G('null generator qty', generatorInput({ generatorQty: null })).includes('"generator_qty":null'));
ok('the two revisions are different strings for the same staged items', P('cmp p', pricingInput()) !== G('cmp g', generatorInput()));

console.log(`\nOrder detail revision tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} order detail revision test(s) failed`);
