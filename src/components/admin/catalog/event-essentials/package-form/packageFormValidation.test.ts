// Characterization tests for validatePackageForm (moved verbatim from
// PackageForm.validate()).
//
// These pin the CURRENT rules and messages. They are not a statement of
// desired behavior: where a rule looks odd it is pinned as-is and called out
// in a comment.

import { validatePackageForm } from './packageFormValidation';
import type { PackageFormValidationInput } from './packageFormValidation';
import type { PackageFormState } from './packageFormModel';
import type { InventoryProductWithPricing, AdminInflatableUnit } from '../../../../../types';

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}: expected ${e}, got ${a}`); }
}

// --- fixtures ------------------------------------------------------------------

const PRODUCTS = [
  { id: 'p1', name: 'Folding Chair' },
  { id: 'p2', name: 'Round Table' },
] as unknown as InventoryProductWithPricing[];

function unit(overrides: Record<string, unknown>): AdminInflatableUnit {
  return { id: 'u1', name: 'Bouncy Castle', active: true, price_dry_cents: 10000, price_water_cents: 12000, ...overrides } as unknown as AdminInflatableUnit;
}

const UNITS = [
  unit({ id: 'u1', name: 'Bouncy Castle' }),
  unit({ id: 'u-dry', name: 'Dry Only Slide', price_water_cents: null }),
  unit({ id: 'u-water', name: 'Water Only Slide', price_dry_cents: null }),
  unit({ id: 'u-nowater-undef', name: 'Undefined Water', price_water_cents: undefined }),
];

function form(overrides: Record<string, unknown> = {}): PackageFormState {
  return {
    id: null,
    slug: '',
    name: 'Party Pack',
    description: '',
    image_url: null,
    standalone_enabled: false,
    standalone_price_cents: null,
    addon_enabled: false,
    addon_price_cents: null,
    active: true,
    public_visible: true,
    menu_visible: true,
    featured: false,
    sort_order: 1,
    components: [{ product_id: 'p1', quantity_input: '2' }],
    addon_qualifying_threshold_cents: null,
    inflatable_eligibility_mode: 'none',
    excluded_category_ids: [],
    eligible_unit_ids: [],
    inflatable_components: [],
    ...overrides,
  } as unknown as PackageFormState;
}

function run(
  formOverrides: Record<string, unknown> = {},
  extra: Partial<Omit<PackageFormValidationInput, 'formData'>> = {},
): Record<string, string> {
  return validatePackageForm({
    formData: form(formOverrides),
    standalonePriceDisplay: '',
    addonPriceDisplay: '',
    addonThresholdDisplay: '',
    products: PRODUCTS,
    units: UNITS,
    ...extra,
  });
}

const FORMAT_MSG = 'Enter a valid dollar amount (e.g. 12, 12.50)';
const TOO_LARGE_MSG = 'Price is too large.';

// --- baseline ------------------------------------------------------------------

eq('a minimal valid package has no errors', run(), {});

// --- name ----------------------------------------------------------------------

eq('empty name is required', run({ name: '' }).name, 'Name is required');
eq('whitespace-only name is required', run({ name: '   ' }).name, 'Name is required');
eq('valid name has no name error', run({ name: 'X' }).name, undefined);

// --- sort order ------------------------------------------------------------------

eq('fractional sort order rejected', run({ sort_order: 1.5 }).sort_order, 'Sort order must be a whole integer');
eq('NaN sort order rejected', run({ sort_order: NaN }).sort_order, 'Sort order must be a whole integer');
eq('zero sort order accepted', run({ sort_order: 0 }).sort_order, undefined);
eq('negative integer sort order accepted', run({ sort_order: -3 }).sort_order, undefined);

// --- standalone price ------------------------------------------------------------

eq('standalone enabled + blank price is required',
  run({ standalone_enabled: true }, { standalonePriceDisplay: '' }).standalone_price,
  'Required when standalone is enabled');
eq('standalone enabled + whitespace price is required',
  run({ standalone_enabled: true }, { standalonePriceDisplay: '   ' }).standalone_price,
  'Required when standalone is enabled');
eq('standalone disabled + blank price is fine',
  run({ standalone_enabled: false }, { standalonePriceDisplay: '' }).standalone_price, undefined);
eq('standalone valid price accepted',
  run({ standalone_enabled: true }, { standalonePriceDisplay: '12.50' }).standalone_price, undefined);
eq('standalone bad format rejected even when disabled',
  run({ standalone_enabled: false }, { standalonePriceDisplay: 'abc' }).standalone_price, FORMAT_MSG);
eq('standalone three decimals rejected',
  run({ standalone_enabled: true }, { standalonePriceDisplay: '1.234' }).standalone_price, FORMAT_MSG);
eq('standalone too large rejected',
  run({ standalone_enabled: true }, { standalonePriceDisplay: '99999999999' }).standalone_price, TOO_LARGE_MSG);

// --- add-on price ----------------------------------------------------------------

eq('add-on enabled + blank price is required',
  run({ addon_enabled: true }, { addonPriceDisplay: '', addonThresholdDisplay: '5' }).addon_price,
  'Required when add-on is enabled');
eq('add-on disabled + blank price is fine',
  run({ addon_enabled: false }, { addonPriceDisplay: '' }).addon_price, undefined);
eq('add-on valid price accepted',
  run({ addon_enabled: true }, { addonPriceDisplay: '3', addonThresholdDisplay: '5' }).addon_price, undefined);
eq('add-on bad format rejected',
  run({ addon_enabled: true }, { addonPriceDisplay: '-3', addonThresholdDisplay: '5' }).addon_price, FORMAT_MSG);
eq('add-on too large rejected',
  run({ addon_enabled: true }, { addonPriceDisplay: '21474836.48', addonThresholdDisplay: '5' }).addon_price, TOO_LARGE_MSG);

// --- add-on qualifying threshold ---------------------------------------------------

eq('threshold required when add-on enabled',
  run({ addon_enabled: true }, { addonPriceDisplay: '3', addonThresholdDisplay: '' }).addon_threshold,
  'Required when add-on is enabled');
eq('threshold blank is fine when add-on disabled',
  run({ addon_enabled: false }, { addonThresholdDisplay: '' }).addon_threshold, undefined);
eq('threshold bad format rejected even when add-on disabled',
  run({ addon_enabled: false }, { addonThresholdDisplay: 'abc' }).addon_threshold, FORMAT_MSG);
eq('threshold valid accepted',
  run({ addon_enabled: true }, { addonPriceDisplay: '3', addonThresholdDisplay: '25' }).addon_threshold, undefined);
// Pinned oddity: the "Value is too large" branch (cents > MAX_INT) can never run,
// because parsePrice already returns too_large for anything over the same limit.
eq('threshold over the limit reports the parsePrice message, not "Value is too large"',
  run({ addon_enabled: true }, { addonPriceDisplay: '3', addonThresholdDisplay: '21474836.48' }).addon_threshold,
  TOO_LARGE_MSG);
eq('threshold exactly at the limit is accepted',
  run({ addon_enabled: true }, { addonPriceDisplay: '3', addonThresholdDisplay: '21474836.47' }).addon_threshold, undefined);

// --- Event Essential components ----------------------------------------------------

eq('component without product',
  run({ components: [{ product_id: '', quantity_input: '1' }] }).components,
  'Component 1: Select a product.');
eq('unknown product no longer exists',
  run({ components: [{ product_id: 'zzz', quantity_input: '1' }] }).components,
  'Component 1: Selected product no longer exists.');
eq('duplicate product names the product',
  run({ components: [{ product_id: 'p1', quantity_input: '1' }, { product_id: 'p1', quantity_input: '1' }] }).components,
  'Component 2: Duplicate product — Folding Chair is already selected.');
eq('duplicate unknown product reports duplicate then missing',
  run({ components: [{ product_id: 'zzz', quantity_input: '1' }, { product_id: 'zzz', quantity_input: '1' }] }).components,
  'Component 1: Selected product no longer exists. Component 2: Duplicate product — Unknown Product is already selected. Component 2: Selected product no longer exists.');
eq('distinct products are accepted',
  run({ components: [{ product_id: 'p1', quantity_input: '1' }, { product_id: 'p2', quantity_input: '4' }] }).components, undefined);
eq('component quantity required',
  run({ components: [{ product_id: 'p1', quantity_input: '' }] }).components, 'Component 1: Quantity is required.');
eq('component quantity whitespace counts as blank',
  run({ components: [{ product_id: 'p1', quantity_input: '  ' }] }).components, 'Component 1: Quantity is required.');
eq('component quantity must be whole positive digits (letters)',
  run({ components: [{ product_id: 'p1', quantity_input: 'abc' }] }).components,
  'Component 1: Quantity must be a whole positive number.');
eq('component quantity must be whole positive digits (decimal)',
  run({ components: [{ product_id: 'p1', quantity_input: '1.5' }] }).components,
  'Component 1: Quantity must be a whole positive number.');
eq('component quantity must be whole positive digits (negative)',
  run({ components: [{ product_id: 'p1', quantity_input: '-1' }] }).components,
  'Component 1: Quantity must be a whole positive number.');
eq('component quantity zero',
  run({ components: [{ product_id: 'p1', quantity_input: '0' }] }).components, 'Component 1: Quantity must be at least 1.');
eq('component quantity too large',
  run({ components: [{ product_id: 'p1', quantity_input: '2147483648' }] }).components, 'Component 1: Quantity is too large.');
eq('component quantity at the limit accepted',
  run({ components: [{ product_id: 'p1', quantity_input: '2147483647' }] }).components, undefined);
eq('quantity is still checked when the product is missing',
  run({ components: [{ product_id: '', quantity_input: '' }] }).components,
  'Component 1: Select a product. Component 1: Quantity is required.');
eq('multiple component problems are joined with a space, in row order',
  run({ components: [{ product_id: '', quantity_input: '1' }, { product_id: 'p1', quantity_input: '0' }] }).components,
  'Component 1: Select a product. Component 2: Quantity must be at least 1.');

// --- inflatable components ---------------------------------------------------------

function inflatable(unit_id: string, quantity_input = '1', selection_mode = 'dry') {
  return { unit_id, quantity_input, selection_mode };
}

eq('inflatable without unit',
  run({ inflatable_components: [inflatable('')] }).inflatable_components, 'Inflatable 1: Select a unit.');
eq('unknown unit no longer exists',
  run({ inflatable_components: [inflatable('nope')] }).inflatable_components, 'Inflatable 1: Selected unit no longer exists.');
eq('duplicate unit names the unit',
  run({ inflatable_components: [inflatable('u1'), inflatable('u1')] }).inflatable_components,
  'Inflatable 2: Duplicate unit — Bouncy Castle is already selected. Use one row per unit.');
eq('distinct units accepted',
  run({ inflatable_components: [inflatable('u1'), inflatable('u-dry')] }).inflatable_components, undefined);
eq('dry mode is always accepted, even for a dry-only unit',
  run({ inflatable_components: [inflatable('u-dry', '1', 'dry')] }).inflatable_components, undefined);
eq('water mode rejected when unit has no water price (null)',
  run({ inflatable_components: [inflatable('u-dry', '1', 'water')] }).inflatable_components,
  'Inflatable 1: Dry Only Slide does not support water mode.');
eq('water mode rejected when unit water price is undefined',
  run({ inflatable_components: [inflatable('u-nowater-undef', '1', 'water')] }).inflatable_components,
  'Inflatable 1: Undefined Water does not support water mode.');
eq('water mode accepted when unit has a water price',
  run({ inflatable_components: [inflatable('u-water', '1', 'water')] }).inflatable_components, undefined);
eq('customer choice rejected when unit has no water price',
  run({ inflatable_components: [inflatable('u-dry', '1', 'customer_choice')] }).inflatable_components,
  'Inflatable 1: Dry Only Slide does not support both dry and water; customer choice is unavailable.');
eq('customer choice rejected when unit has no dry price',
  run({ inflatable_components: [inflatable('u-water', '1', 'customer_choice')] }).inflatable_components,
  'Inflatable 1: Water Only Slide does not support both dry and water; customer choice is unavailable.');
eq('customer choice accepted when unit has both prices',
  run({ inflatable_components: [inflatable('u1', '1', 'customer_choice')] }).inflatable_components, undefined);
eq('inflatable quantity required',
  run({ inflatable_components: [inflatable('u1', '')] }).inflatable_components, 'Inflatable 1: Quantity is required.');
eq('inflatable quantity must be whole positive digits',
  run({ inflatable_components: [inflatable('u1', '2.5')] }).inflatable_components,
  'Inflatable 1: Quantity must be a whole positive number.');
eq('inflatable quantity zero',
  run({ inflatable_components: [inflatable('u1', '0')] }).inflatable_components, 'Inflatable 1: Quantity must be at least 1.');
eq('inflatable quantity too large',
  run({ inflatable_components: [inflatable('u1', '2147483648')] }).inflatable_components, 'Inflatable 1: Quantity is too large.');
eq('inflatable quantity at the limit accepted',
  run({ inflatable_components: [inflatable('u1', '2147483647')] }).inflatable_components, undefined);
eq('unit and quantity problems on one row are both reported',
  run({ inflatable_components: [inflatable('', '0')] }).inflatable_components,
  'Inflatable 1: Select a unit. Inflatable 1: Quantity must be at least 1.');

// --- eligibility ---------------------------------------------------------------------

eq('selected mode with no units is rejected',
  run({ inflatable_eligibility_mode: 'selected', eligible_unit_ids: [] }).eligibility,
  'Select at least one eligible inflatable when mode is "Only selected".');
eq('selected mode with a unit is accepted',
  run({ inflatable_eligibility_mode: 'selected', eligible_unit_ids: ['u1'] }).eligibility, undefined);
eq('none mode with no units is accepted',
  run({ inflatable_eligibility_mode: 'none', eligible_unit_ids: [] }).eligibility, undefined);

// --- "available package needs a component" ---------------------------------------------

const NEEDS_COMPONENT =
  'An available package must have at least one component (Event Essential or Inflatable).';
eq('active package with no components is rejected',
  run({ active: true, components: [], inflatable_components: [] }).components, NEEDS_COMPONENT);
eq('inactive package with no components is accepted',
  run({ active: false, components: [], inflatable_components: [] }).components, undefined);
eq('active package with only an inflatable is accepted',
  run({ active: true, components: [], inflatable_components: [inflatable('u1')] }), {});
eq('active package with only a product is accepted',
  run({ active: true, components: [{ product_id: 'p1', quantity_input: '1' }], inflatable_components: [] }), {});

// --- combined behavior -------------------------------------------------------------------

const allBad = run(
  {
    name: '',
    sort_order: 0.5,
    standalone_enabled: true,
    addon_enabled: true,
    inflatable_eligibility_mode: 'selected',
    eligible_unit_ids: [],
    components: [{ product_id: '', quantity_input: '' }],
    inflatable_components: [inflatable('', '')],
  },
  {},
);
eq('every failing rule reports under its own key',
  Object.keys(allBad).sort(),
  ['addon_price', 'addon_threshold', 'components', 'eligibility', 'inflatable_components', 'name', 'sort_order', 'standalone_price']);

// --- purity ------------------------------------------------------------------------------

const frozen = form({ name: '', components: [{ product_id: 'p1', quantity_input: '0' }] });
const before = JSON.stringify(frozen);
validatePackageForm({
  formData: frozen,
  standalonePriceDisplay: 'x',
  addonPriceDisplay: 'y',
  addonThresholdDisplay: 'z',
  products: PRODUCTS,
  units: UNITS,
});
eq('validation does not mutate the form data', JSON.stringify(frozen), before);

console.log(`\nPackage form validation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} package form validation test(s) failed`);
