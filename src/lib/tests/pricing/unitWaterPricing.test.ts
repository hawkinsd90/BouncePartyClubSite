// F-19 / WP-P1-04: Water-mode pricing rules. The client helper (Admin items editor) and the server rule (bookingBuild) must agree.
// Behavioural differential between the two copies, plus source-level wiring checks (labelled as such; this is not a UI render test).
import { readFileSync } from 'node:fs';
import { effectiveWaterPriceCents, unitSupportsWater } from '../../pricing/unitWaterPricing';
import { effectiveUnitPriceCents, unitSupportsWater as serverSupportsWater } from '../../../../supabase/functions/_shared/booking/bookingBuild';

let passed = 0;
let failed = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8');

type U = { types?: string[] | null; price_dry_cents: number; price_water_cents: number | null | undefined };
const U = (types: string[] | null | undefined, dry: number, water: number | null | undefined): U => ({ types, price_dry_cents: dry, price_water_cents: water });

// ---- the rule -------------------------------------------------------------------------------------------------------------------
eq('Combo, water 0 => supports Water at the base price', [unitSupportsWater(U(['Combo'], 20000, 0)), effectiveWaterPriceCents(U(['Combo'], 20000, 0))], [true, 20000]);
eq('Combo, water null => supports Water at the base price', [unitSupportsWater(U(['Combo'], 20000, null)), effectiveWaterPriceCents(U(['Combo'], 20000, null))], [true, 20000]);
eq('Combo, water undefined => base price', effectiveWaterPriceCents(U(['Combo'], 20000, undefined)), 20000);
eq('Water Slide, water 0 => base price', effectiveWaterPriceCents(U(['Water Slide'], 18000, 0)), 18000);
eq('Combo with a real water price keeps it', effectiveWaterPriceCents(U(['Combo'], 20000, 25000)), 25000);
eq('dry-only unit, water 0 => no Water', [unitSupportsWater(U(['Bounce House'], 15000, 0)), effectiveWaterPriceCents(U(['Bounce House'], 15000, 0))], [false, null]);
eq('dry-only unit, water null => no Water', effectiveWaterPriceCents(U(['Bounce House'], 15000, null)), null);
eq('unit without types and without a water price => no Water', effectiveWaterPriceCents(U(undefined, 15000, 0)), null);
eq('unit without types but with a real water price still offers Water (existing behaviour)', effectiveWaterPriceCents(U(null, 15000, 17000)), 17000);
eq('a negative water price is not a real price', effectiveWaterPriceCents(U(['Bounce House'], 15000, -5)), null);

// ---- differential: client helper and server rule give the same answer for every combination -----------------------------------
const typeSets: Array<string[] | null | undefined> = [undefined, null, [], ['Bounce House'], ['Combo'], ['Water Slide'], ['Combo', 'Water Slide'], ['Obstacle Course']];
const waters: Array<number | null | undefined> = [undefined, null, 0, -1, 1, 25000];
let combos = 0;
let agree = true;
for (const types of typeSets) {
  for (const water of waters) {
    const unit = U(types, 20000, water);
    const server = { price_dry_cents: 20000, price_water_cents: water ?? null, types };
    combos++;
    if (unitSupportsWater(unit) !== serverSupportsWater(server)) agree = false;
    if (effectiveWaterPriceCents(unit) !== effectiveUnitPriceCents(server, 'water')) agree = false;
    if (effectiveUnitPriceCents(server, 'dry') !== 20000) agree = false;
    const price = effectiveWaterPriceCents(unit);
    if (price === 0) agree = false; // never a free unit when the base price is positive
  }
}
eq(`client and server agree on all ${combos} type / water-price combinations and never price a unit at 0`, agree, true);

// ---- source-level wiring (not a UI render test) ------------------------------------------------------------------------------------
const editor = read('src/components/shared/ItemsEditor.tsx');
eq('source: ItemsEditor gates Water on wet support and labels the effective price', editor.includes('unitSupportsWater(unit) &&') && editor.includes('effectiveWaterPriceCents(unit)') && !editor.includes('(unit.price_water_cents || 0) > 0 &&'), true);

console.log(`\nF-19 unit water pricing tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
