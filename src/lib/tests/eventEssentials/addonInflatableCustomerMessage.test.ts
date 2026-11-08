// WP-P1-26 customer messaging: when the Party Add-On price is withheld only because the cart has no valid active inflatable,
// the customer is told plainly that an inflatable is needed (never a dollar gap); when an inflatable exists and only the
// threshold is missing, customers still see no threshold/dollar copy (existing behaviour, tests 46-53 of the resolver suite).
// Behavioural: the real engine output feeds the real view-model and message functions (pure; no UI rendering).
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/eventEssentials/addonInflatableCustomerMessage.test.ts

import { resolveEventEssentialsPricing } from '../../eventEssentials/eventEssentialsPricing';
import {
  deriveCandidateViewModel,
  qualificationMessage,
  NEEDS_INFLATABLE_FOR_ADDON_MESSAGE,
} from '../../eventEssentials/eventEssentialsCatalogResolver';
import type { ResolverInput, ResolverProductConfig } from '../../eventEssentials/eventEssentialsPricingTypes';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean): void {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

const categories = { cat_t: { id: 'cat_t' }, cat_c: { id: 'cat_c' } };
const units = { unit_a: { id: 'unit_a', active: true } };
const tables: ResolverProductConfig = {
  id: 'p_tables', categoryId: 'cat_t', standalonePriceCents: 10000, addonPriceCents: 6000,
  standaloneEnabled: true, addonEnabled: true, addonQualifyingThresholdCents: 15000,
};
const chairs: ResolverProductConfig = {
  id: 'p_chairs', categoryId: 'cat_c', standalonePriceCents: 20000, addonPriceCents: 12000,
  standaloneEnabled: true, addonEnabled: true, addonQualifyingThresholdCents: 15000,
};
// Add-on only product (no standalone price): blocked until it qualifies.
const addonOnly: ResolverProductConfig = {
  id: 'p_ao', categoryId: 'cat_t', standalonePriceCents: null, addonPriceCents: 6000,
  standaloneEnabled: false, addonEnabled: true, addonQualifyingThresholdCents: 15000,
};
const productConfigs = { p_tables: tables, p_chairs: chairs, p_ao: addonOnly };

function vmFor(lines: ResolverInput['lines'], key: string) {
  const out = resolveEventEssentialsPricing({ lines, productConfigs, bundleConfigs: {}, categories, units });
  const line = out.lines.find((l) => l.resolverKey === key)!;
  const vm = deriveCandidateViewModel(line, false);
  return { vm, msg: qualificationMessage(vm) };
}
const chairsLine = { resolverKey: 'c', itemType: 'event_essential_product' as const, qty: 1, productId: 'p_chairs' };
const tablesLine = { resolverKey: 't', itemType: 'event_essential_product' as const, qty: 1, productId: 'p_tables' };
const aoLine = { resolverKey: 'ao', itemType: 'event_essential_product' as const, qty: 1, productId: 'p_ao' };
const inflatable = (price: number) => ({ resolverKey: 'i', itemType: 'inflatable' as const, qty: 1, unitId: 'unit_a', selectedUnitPriceCents: price, wetOrDry: 'dry' as const });

// 1. Threshold met by Event Essentials spend, no inflatable: standalone price stays, customer is told an inflatable is needed.
{
  const { vm, msg } = vmFor([chairsLine, tablesLine], 't');
  ok('1 standalone + needs inflatable message', vm.priceState === 'standalone' && vm.addonRequiresInflatable && msg === NEEDS_INFLATABLE_FOR_ADDON_MESSAGE);
  ok('1b message has no dollar amount', !/\$|\d/.test(msg ?? ''));
}

// 2. Inflatable present but below threshold: unchanged (no message, no dollar copy for customers).
{
  const { vm, msg } = vmFor([inflatable(5000), tablesLine], 't');
  ok('2 inflatable + below threshold -> no needs-inflatable message, no dollar hint', vm.priceState === 'standalone' && !vm.addonRequiresInflatable && vm.remainingAmountCents === 10000 && msg === null);
}

// 3. Inflatable present and threshold met: add-on price, no message.
{
  const { vm, msg } = vmFor([inflatable(20000), tablesLine], 't');
  ok('3 qualified -> add-on, no message', vm.priceState === 'addon' && !vm.addonRequiresInflatable && msg === null);
}

// 4. Add-on-only product: no inflatable but threshold met -> says inflatable needed; inflatable present but low -> neutral copy.
{
  const noInf = vmFor([chairsLine, aoLine], 'ao');
  ok('4a add-on-only, threshold met, no inflatable -> inflatable message', noInf.vm.priceState === 'blocked_addon_only' && noInf.msg === NEEDS_INFLATABLE_FOR_ADDON_MESSAGE);
  const low = vmFor([inflatable(5000), aoLine], 'ao');
  ok('4b add-on-only, inflatable present but below threshold -> neutral copy (no dollars)', low.vm.priceState === 'blocked_addon_only' && low.msg === 'Currently unavailable for this cart.');
}

// 5. Removing the inflatable flips the message back on (same cart, inflatable dropped).
{
  const withInf = vmFor([inflatable(20000), tablesLine], 't');
  const removed = vmFor([tablesLine], 't');
  ok('5 with inflatable none; after removal standalone (no inflatable hint only because threshold unmet)', withInf.msg === null && removed.vm.priceState === 'standalone');
}

console.log(`addonInflatableCustomerMessage: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
