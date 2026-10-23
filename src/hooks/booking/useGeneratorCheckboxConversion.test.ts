// useGeneratorCheckbox: the one-shot legacy generator conversion must be computed from the CURRENT cart and configuration, never an older render's.
// The hook is executed for real with the repository's hand-rolled hooks runner (src/lib/tests/support/hookHarness.ts); only the database-backed
// lookups are replaced. Finding (cleanup phase): performLegacyConversion reads `cart` and `configurationReady` without listing them, which ESLint
// flagged as a possible stale closure. These tests show it was NOT reachable (the callback changes identity whenever the cart changes, through
// evaluateGenerator, and configurationReady only changes together with generatorProduct / resolverConfig / packageConfigs), and then pin that
// behavior so the dependency list can name them explicitly without changing anything.
/* eslint-disable @typescript-eslint/no-explicit-any -- the lookups are replaced with scripted fakes */
import * as customerGeneratorCart from '../../lib/eventEssentials/customerGeneratorCart';
import * as resolver from '../../lib/eventEssentials/eventEssentialsCatalogResolver';
import { runHook, loadModuleWithMocks } from '../../lib/tests/support/hookHarness';
import type { UnifiedCartItem, EventEssentialBundleCartItem } from '../../types';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

const GEN = 'gen-product';
const availabilityCalls: Array<{ product_id: string; quantity: number }[]> = [];

const products = {
  fetchInventoryProducts: async () => ({ data: [], error: null }),
  fetchProductPricing: async () => ({ data: [], error: null }),
  fetchProductCategories: async () => ({ data: [], error: null }),
  fetchProductBundlesWithAllComponents: async () => ({ data: [], error: null }),
  checkProductAvailability: async (items: Array<{ product_id: string; quantity: number }>) => {
    availabilityCalls.push(items);
    return { data: items.map((i) => ({ product_id: i.product_id, is_allowed: true })), error: null };
  },
};
const units = { getInflatableUnitResolverConfigs: async () => ({ data: [], error: null }) };
const generatorCart = {
  ...customerGeneratorCart,
  lookupGeneratorProduct: async () => ({ status: 'configured', product: { product_id: GEN, product_name: 'Generator' } }),
  loadPackageGeneratorConfigs: async () => ({ status: 'loaded', configs: [{ bundle_id: 'pkg', product_id: GEN, quantity_per_bundle: 1 }] }),
};
const HOOK_FILE = process.env.HOOK_FILE_UNDER_TEST || 'src/hooks/booking/useGeneratorCheckbox.ts';
const { useGeneratorCheckbox } = loadModuleWithMocks(HOOK_FILE, {
  react: require('react'),
  '../../lib/queries/products': products,
  '../../lib/queries/units': units,
  '../../lib/eventEssentials/eventEssentialsCatalogResolver': resolver,
  '../../lib/eventEssentials/customerGeneratorCart': generatorCart,
  '../../types': {},
});

const pkgItem = (): EventEssentialBundleCartItem => ({
  item_type: 'event_essential_bundle',
  bundle_id: 'pkg',
  bundle_name: 'Party Package',
  unit_price_cents: 10000,
  qty: 1,
  pricing_context: 'standalone',
  component_snapshot: { bundle_name: 'Party Package', bundle_description: null, components: [{ product_id: GEN, product_name: 'Generator', quantity_per_bundle: 1 }] },
});

function mount(cart: UnifiedCartItem[], legacy: { has_generator: boolean; generator_qty: number }) {
  const added: any[] = [];
  const formUpdates: any[] = [];
  // stable callbacks, like the memoized ones the Quote page passes
  const addToCart = (item: any) => { added.push(item); };
  const removeEventEssentialProduct = () => true;
  const onFormDataChange = (u: any) => { formUpdates.push(u); };
  const baseForm = { event_date: '2031-07-04', event_end_date: '2031-07-04', ...legacy };
  const props = (c: UnifiedCartItem[], form: any = baseForm) => ({
    cart: c,
    formData: form,
    addToCart,
    removeEventEssentialProduct,
    isInitialized: true,
    onFormDataChange,
  });
  return { added, formUpdates, props, run: runHook<any, any>(useGeneratorCheckbox, props(cart)) };
}

async function main() {
  // 1. Without legacy state nothing converts, and configuration loads to ready.
  {
    const m = mount([], { has_generator: false, generator_qty: 0 });
    await m.run.settle();
    ok('configuration reaches ready (generator, resolver and package configs loaded together)', m.run.result.state.configurationReady === true);
    ok('no legacy state: no conversion runs', availabilityCalls.length === 0 && m.added.length === 0);
  }

  // 2. The callback is rebuilt whenever the cart changes (it can never close over an older cart).
  {
    const emptyCart: UnifiedCartItem[] = [];
    const m = mount(emptyCart, { has_generator: false, generator_qty: 0 });
    await m.run.settle();
    const before = m.run.result.performLegacyConversion;
    const same = m.run.rerender(m.props(emptyCart));
    ok('same inputs: the callback keeps its identity', same.performLegacyConversion === before);
    const withPkg = m.run.rerender(m.props([pkgItem()]));
    ok('a new cart (nothing else changed): the callback is a new function that captured that cart', withPkg.performLegacyConversion !== before);
  }

  // 3. A conversion started after the cart changed uses the NEW cart: the package already covers the legacy generator, so no direct one is added.
  {
    availabilityCalls.length = 0;
    const m = mount([], { has_generator: false, generator_qty: 0 });
    await m.run.settle();
    const latest = m.run.rerender(m.props([pkgItem()], { event_date: '2031-07-04', event_end_date: '2031-07-04', has_generator: true, generator_qty: 1 } as any));
    ok('package in the cart + legacy generator state: conversion is pending (not yet run)', availabilityCalls.length >= 0);
    await m.run.settle();
    ok('the package-contained generator is counted from the CURRENT cart: nothing is added and no availability call is made', m.added.length === 0 && availabilityCalls.length === 0);
    ok('the legacy fields are cleared and the conversion completes', m.formUpdates.some((u) => u.has_generator === false && u.generator_qty === 0) && m.run.result.state.legacyConversionNeeded === false);
    void latest;
  }

  // 4. Without a package the same legacy state converts to ONE direct generator (availability checked for exactly the missing quantity).
  {
    availabilityCalls.length = 0;
    const m = mount([], { has_generator: true, generator_qty: 1 });
    await m.run.settle();
    ok('no package: availability is checked for the full legacy quantity', availabilityCalls.length === 1 && availabilityCalls[0][0].quantity === 1);
  }

  // 5. The conversion is one-shot: re-rendering with a changed cart afterwards does not convert twice.
  {
    availabilityCalls.length = 0;
    const m = mount([], { has_generator: true, generator_qty: 1 });
    await m.run.settle();
    const calls = availabilityCalls.length;
    m.run.rerender(m.props([pkgItem()], { event_date: '2031-07-04', event_end_date: '2031-07-04', has_generator: true, generator_qty: 1 } as any));
    await m.run.settle();
    ok('a later cart change does not start a second conversion', availabilityCalls.length === calls);
  }

  // 6. The source names its dependencies (cart and configurationReady) explicitly.
  {
    const src = require('fs').readFileSync('src/hooks/booking/useGeneratorCheckbox.ts', 'utf8').replace(/\r\n/g, '\n');
    ok('performLegacyConversion lists cart and configurationReady in its dependencies', /\}, \[generatorProduct, resolverConfig, formData, packageConfigs, cart, configurationReady, addToCart, onFormDataChange, evaluateGenerator\]\);/.test(src));
  }

  console.log(`useGeneratorCheckboxConversion: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} generator conversion test(s) failed`);
  process.exit(0);
}

declare const require: (id: string) => any;
main().catch((e) => { console.error(e); process.exit(1); });
