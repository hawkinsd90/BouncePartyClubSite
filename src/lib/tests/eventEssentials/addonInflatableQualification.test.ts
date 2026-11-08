// D3 / WP-P1-26 (owner decision DEC-21 / B-8): the discounted Event Essentials add-on price applies only when the
// order contains a VALID, ACTIVE inflatable that is still in the order AND the existing qualifying-subtotal threshold
// is met. Event Essentials-only orders stay bookable at standalone prices. No threshold, amount or config is new.
//
// Behavioural: the real client engine (src/lib/eventEssentials) and its generated server copy
// (supabase/functions/_shared/booking) run the same scenarios. The one source-level check is labelled.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/eventEssentials/addonInflatableQualification.test.ts

import { readFileSync } from 'node:fs';
import { resolveEventEssentialsPricing as clientResolve } from '../../eventEssentials/eventEssentialsPricing';
import { repriceEventEssentialsCart as clientReprice } from '../../eventEssentials/eventEssentialsCartRepricing';
import { resolveEventEssentialsPricing as serverResolve } from '../../../../supabase/functions/_shared/booking/eventEssentialsPricing';
import { repriceEventEssentialsCart as serverReprice } from '../../../../supabase/functions/_shared/booking/eventEssentialsCartRepricing';
import { priceChangedSinceShown } from '../../../../supabase/functions/_shared/booking/createBooking';
import type {
  ResolverBundleConfig,
  ResolverInput,
  ResolverInputLine,
  ResolverProductConfig,
  ResolverUnitConfig,
} from '../../eventEssentials/eventEssentialsPricingTypes';
import type { UnifiedCartItem, InflatableCartItem, EventEssentialProductCartItem } from '../../../types';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean): void {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

const C_TABLES = 'cat_tables';
const C_CHAIRS = 'cat_chairs';
const U_A = 'unit_a';
const U_B = 'unit_b';
const U_OFF = 'unit_inactive';

const categories = { [C_TABLES]: { id: C_TABLES }, [C_CHAIRS]: { id: C_CHAIRS } };
const unitsAllActive: Record<string, ResolverUnitConfig> = {
  [U_A]: { id: U_A, active: true },
  [U_B]: { id: U_B, active: true },
  [U_OFF]: { id: U_OFF, active: false },
};

// Existing pricing config (nothing new): standalone 10000, add-on 6000, threshold 15000.
const tables: ResolverProductConfig = {
  id: 'p_tables', categoryId: C_TABLES, standalonePriceCents: 10000, addonPriceCents: 6000,
  standaloneEnabled: true, addonEnabled: true, addonQualifyingThresholdCents: 15000,
};
const chairs: ResolverProductConfig = {
  id: 'p_chairs', categoryId: C_CHAIRS, standalonePriceCents: 20000, addonPriceCents: 12000,
  standaloneEnabled: true, addonEnabled: true, addonQualifyingThresholdCents: 15000,
};
const pkg: ResolverBundleConfig = {
  id: 'b_pkg', standalonePriceCents: 30000, addonPriceCents: 20000, standaloneEnabled: true, addonEnabled: true,
  addonQualifyingThresholdCents: 15000, inflatableEligibilityMode: 'none', excludedCategoryIds: [],
  eligibleUnitIds: [], inflatableComponents: [], containedProductCategoryIds: [C_CHAIRS],
};

const productConfigs = { p_tables: tables, p_chairs: chairs };
const bundleConfigs = { b_pkg: pkg };

function inf(unitId: string, price: number, qty = 1): InflatableCartItem {
  return { unit_id: unitId, unit_name: unitId, wet_or_dry: 'dry', unit_price_cents: price, price_dry_cents: price, price_water_cents: price, qty };
}
function prod(productId: string, price: number, ctx: 'standalone' | 'addon', qty = 1): EventEssentialProductCartItem {
  return { item_type: 'event_essential_product', product_id: productId, product_name: productId, unit_price_cents: price, qty, pricing_context: ctx };
}
function tablesLine(cart: UnifiedCartItem[]): EventEssentialProductCartItem {
  return cart.find((c) => (c as EventEssentialProductCartItem).product_id === 'p_tables') as EventEssentialProductCartItem;
}
function isInflatable(c: UnifiedCartItem, unitId: string): boolean {
  return (c as InflatableCartItem).unit_id === unitId;
}

const engines = [
  { name: 'client', resolve: clientResolve, reprice: clientReprice },
  { name: 'server copy', resolve: serverResolve, reprice: serverReprice },
] as const;

for (const e of engines) {
  const price = (cart: UnifiedCartItem[]) => {
    const r = e.reprice({ cart, productConfigs, bundleConfigs, categories, units: unitsAllActive });
    return { result: r, tables: tablesLine(r.cart) };
  };
  const t = (s: string) => `[${e.name}] ${s}`;
  const input = (lines: ResolverInputLine[]): ResolverInput => ({ lines, productConfigs, bundleConfigs, categories, units: unitsAllActive });

  // 1. Eligible active inflatable at/above the existing threshold -> add-on price.
  {
    const { tables: l, result } = price([inf(U_A, 20000), prod('p_tables', 10000, 'standalone')]);
    ok(t('1 active inflatable above threshold -> add-on 6000'), l.pricing_context === 'addon' && l.unit_price_cents === 6000 && result.issues.length === 0);
  }

  // 2. Event Essentials-only order stays bookable at standalone pricing, even when other EE spend exceeds the threshold.
  {
    const { tables: l, result } = price([prod('p_chairs', 20000, 'standalone'), prod('p_tables', 10000, 'standalone')]);
    ok(t('2 EE-only (chairs 20000 >= threshold) -> tables standalone 10000, no blocking issue'), l.pricing_context === 'standalone' && l.unit_price_cents === 10000 && result.issues.length === 0);
    const solo = price([prod('p_tables', 10000, 'standalone')]);
    ok(t('2b single EE product standalone, no issue'), solo.tables.pricing_context === 'standalone' && solo.result.issues.length === 0);
  }

  // 3. Removing the qualifying inflatable recalculates the add-on back to standalone (a stored add-on price is not trusted).
  {
    const before = price([inf(U_A, 20000), prod('p_tables', 10000, 'standalone')]);
    ok(t('3 before removal -> add-on'), before.tables.pricing_context === 'addon');
    const after = price(before.result.cart.filter((c) => !isInflatable(c, U_A)));
    ok(t('3 after removal -> standalone 10000 and cart marked changed'), after.tables.pricing_context === 'standalone' && after.tables.unit_price_cents === 10000 && after.result.changed === true);
  }

  // 4. Replacing the inflatable with another eligible one preserves qualification.
  {
    const first = price([inf(U_A, 20000), prod('p_tables', 10000, 'standalone')]);
    const swapped = price([inf(U_B, 18000), first.tables]);
    ok(t('4 replacement active inflatable keeps add-on 6000'), swapped.tables.pricing_context === 'addon' && swapped.tables.unit_price_cents === 6000 && swapped.result.changed === false);
  }

  // 5. Inactive, unknown and zero-quantity inflatables do not qualify.
  {
    const inactive = price([inf(U_OFF, 20000), prod('p_tables', 10000, 'standalone')]);
    ok(t('5a inactive inflatable does not qualify'), inactive.tables.pricing_context === 'standalone' && inactive.tables.unit_price_cents === 10000);
    const unknown = price([inf('unit_missing', 20000), prod('p_tables', 10000, 'standalone')]);
    ok(t('5b unknown inflatable does not qualify'), unknown.tables.pricing_context === 'standalone');
    const zeroQty = price([inf(U_A, 20000, 0), prod('p_tables', 10000, 'standalone')]);
    ok(t('5c zero-quantity inflatable does not qualify'), zeroQty.tables.pricing_context === 'standalone');
    const qualified = price([inf(U_A, 20000), prod('p_tables', 10000, 'standalone')]);
    const swappedToInactive = price([inf(U_OFF, 20000), qualified.tables]);
    ok(t('5d replacing the inflatable with an inactive one drops the add-on'), swappedToInactive.tables.pricing_context === 'standalone' && swappedToInactive.tables.unit_price_cents === 10000);
    const oneOfTwo = price([inf(U_OFF, 20000), inf(U_B, 20000), prod('p_tables', 10000, 'standalone')]);
    ok(t('5e a valid inflatable next to an inactive one is enough'), oneOfTwo.tables.pricing_context === 'addon');
  }

  // 6. The existing threshold is unchanged: valid inflatable below it -> standalone; exactly at it -> add-on.
  {
    const below = price([inf(U_A, 14999), prod('p_tables', 10000, 'standalone')]);
    ok(t('6a valid inflatable at 14999 (< 15000) -> standalone'), below.tables.pricing_context === 'standalone');
    const at = price([inf(U_A, 15000), prod('p_tables', 10000, 'standalone')]);
    ok(t('6b valid inflatable at exactly 15000 -> add-on'), at.tables.pricing_context === 'addon' && at.tables.unit_price_cents === 6000);
    const mixed = price([inf(U_A, 5000), prod('p_chairs', 10000, 'standalone'), prod('p_tables', 10000, 'standalone')]);
    ok(t('6c existing subtotal rule kept: inflatable 5000 + other-category EE 10000 = 15000 -> add-on'), mixed.tables.pricing_context === 'addon');
  }

  // 7. Packages follow the same rule.
  {
    const noInf = e.resolve(input([
      { resolverKey: 'pkg', itemType: 'event_essential_bundle', qty: 1, bundleId: 'b_pkg' },
      { resolverKey: 'tb', itemType: 'event_essential_product', qty: 3, productId: 'p_tables' },
    ]));
    const p0 = noInf.lines.find((l) => l.resolverKey === 'pkg')!;
    ok(t('7a package: EE-only -> standalone 30000, selectable'), p0.selectable && p0.resolvedPricingContext === 'standalone' && p0.resolvedUnitPriceCents === 30000 && p0.addonQualified === false);
    ok(t('7a package message says the add-on needs an inflatable'), p0.customerMessageCode === 'ADDON_REQUIRES_INFLATABLE');
    const withInf = e.resolve(input([
      { resolverKey: 'pkg', itemType: 'event_essential_bundle', qty: 1, bundleId: 'b_pkg' },
      { resolverKey: 'tb', itemType: 'event_essential_product', qty: 3, productId: 'p_tables' },
      { resolverKey: 'inf', itemType: 'inflatable', qty: 1, unitId: U_A, selectedUnitPriceCents: 1000, wetOrDry: 'dry' },
    ]));
    const p1 = withInf.lines.find((l) => l.resolverKey === 'pkg')!;
    ok(t('7b package: valid inflatable + subtotal 31000 -> add-on 20000'), p1.addonQualified && p1.resolvedPricingContext === 'addon' && p1.resolvedUnitPriceCents === 20000);
  }

  // 8. Customer message distinguishes "needs an inflatable" from "add $X more".
  {
    const noInf = e.resolve(input([
      { resolverKey: 'c', itemType: 'event_essential_product', qty: 1, productId: 'p_chairs' },
      { resolverKey: 't', itemType: 'event_essential_product', qty: 1, productId: 'p_tables' },
    ]));
    ok(t('8a threshold met by EE spend but no inflatable -> ADDON_REQUIRES_INFLATABLE, remaining 0'), noInf.lines[1].customerMessageCode === 'ADDON_REQUIRES_INFLATABLE' && noInf.lines[1].remainingAmountCents === 0);
    const lowInf = e.resolve(input([
      { resolverKey: 'i', itemType: 'inflatable', qty: 1, unitId: U_A, selectedUnitPriceCents: 5000, wetOrDry: 'dry' },
      { resolverKey: 't', itemType: 'event_essential_product', qty: 1, productId: 'p_tables' },
    ]));
    ok(t('8b inflatable present but below threshold -> ADD_REMAINING_TO_QUALIFY (unchanged)'), lowInf.lines[1].customerMessageCode === 'ADD_REMAINING_TO_QUALIFY' && lowInf.lines[1].remainingAmountCents === 10000);
  }

  // 9. Server authority / PRICE_CHANGED: a stale cart that claims the add-on price with no valid inflatable is repriced, and
  //    the resulting total differs from the claimed one, which is what makes create-booking answer PRICE_CHANGED.
  {
    const stale: UnifiedCartItem[] = [prod('p_tables', 6000, 'addon')]; // the client believed it qualified, but the inflatable is gone
    const r = e.reprice({ cart: stale, productConfigs, bundleConfigs, categories, units: unitsAllActive });
    const serverPrice = tablesLine(r.cart).unit_price_cents;
    ok(t('9a server reprices a stale add-on line to standalone and flags the cart as changed'), serverPrice === 10000 && r.changed === true);
    ok(t('9b claimed 6000 vs server 10000 is a PRICE_CHANGED comparison'), priceChangedSinceShown({ claimed_total_cents: 6000, claimed_deposit_cents: null }, { totalCents: serverPrice, depositCents: 0 }) === true);
    const honest = e.reprice({ cart: [inf(U_A, 20000), prod('p_tables', 6000, 'addon')], productConfigs, bundleConfigs, categories, units: unitsAllActive });
    ok(t('9c a genuinely qualified add-on is not changed (no spurious PRICE_CHANGED)'), honest.changed === false && tablesLine(honest.cart).unit_price_cents === 6000);
  }
}

// Source-level (NOT a behavioural test): the generated server copy carries the same gate as the client source.
{
  // (Byte-for-byte client/server sync is enforced by the existing generated-copy test.)
  const client = readFileSync('src/lib/eventEssentials/eventEssentialsPricing.ts', 'utf8').replace(/\r\n/g, '\n');
  const server = readFileSync('supabase/functions/_shared/booking/eventEssentialsPricing.ts', 'utf8').replace(/\r\n/g, '\n');
  ok('source-level: server copy has the valid-inflatable gate', server.includes('function hasValidDirectInflatable') && server.includes('qualifyingSubtotal >= threshold && hasValidInflatable'));
  ok('source-level: client source has the same gate', client.includes('qualifyingSubtotal >= threshold && hasValidInflatable'));
}

console.log(`Add-on inflatable qualification tests (D3 / WP-P1-26): ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
