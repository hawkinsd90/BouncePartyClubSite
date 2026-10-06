// Characterization tests for loadAdminResolverCatalogRowsWith.
//
// The oracle is a verbatim copy of the inline load that appeared in InvoiceBuilder,
// OrderDetailModal and AddEventEssentialsSection:
//   const [catsRes, prodsRes, pricingRes, bundlesRes] = await Promise.all([...four calls...]);
// It never calls the loader. The real query functions cannot be imported under Node
// (they load the Supabase client), so the loader takes the fetchers as arguments and
// these tests inject fakes.

import { loadAdminResolverCatalogRowsWith } from './adminResolverCatalogRows';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL ${label}\n  actual:   ${a}\n  expected: ${e}`); }
}

type Res = { data: unknown[] | null; error: unknown };

// ---- Oracle: verbatim inline load ----
async function oracle(f: {
  cats: () => Promise<Res>; prods: () => Promise<Res>; pricing: () => Promise<Res>; bundles: () => Promise<Res>;
}) {
  const [catsRes, prodsRes, pricingRes, bundlesRes] = await Promise.all([
    f.cats(),
    f.prods(),
    f.pricing(),
    f.bundles(),
  ]);
  return { catsRes, prodsRes, pricingRes, bundlesRes };
}

function makeFakes(results: { cats: Res; prods: Res; pricing: Res; bundles: Res }, log: string[]) {
  return {
    cats: () => { log.push('cats'); return Promise.resolve(results.cats); },
    prods: () => { log.push('prods'); return Promise.resolve(results.prods); },
    pricing: () => { log.push('pricing'); return Promise.resolve(results.pricing); },
    bundles: () => { log.push('bundles'); return Promise.resolve(results.bundles); },
  };
}

async function run() {
  // 1. All four succeed: identity, order, no mutation, no filtering, no normalization.
  {
    const cats: Res = { data: [{ id: 'c1' }, { id: 'c2' }], error: null };
    const prods: Res = { data: [{ id: 'p1', active: false }, { id: 'p2', active: true }], error: null };
    const pricing: Res = { data: [{ product_id: 'p1' }], error: null };
    const bundles: Res = { data: [{ id: 'b1', product_bundle_components: null }], error: null };
    const snapshot = JSON.stringify([cats, prods, pricing, bundles]);
    const log: string[] = [];
    const fakes = makeFakes({ cats, prods, pricing, bundles }, log);
    const actual = await loadAdminResolverCatalogRowsWith({
      fetchCategories: fakes.cats, fetchProducts: fakes.prods, fetchPricing: fakes.pricing, fetchBundles: fakes.bundles,
    });
    const expected = await oracle(makeFakes({ cats, prods, pricing, bundles }, []));
    eq('success: same shape as the inline load', actual, expected);
    ok('success: categories result is the same object', actual.catsRes === cats);
    ok('success: products result is the same object', actual.prodsRes === prods);
    ok('success: pricing result is the same object', actual.pricingRes === pricing);
    ok('success: bundles result is the same object', actual.bundlesRes === bundles);
    ok('success: inactive product not filtered', (actual.prodsRes.data as Array<{ active: boolean }>).length === 2);
    ok('success: null nested field not normalized', (actual.bundlesRes.data as Array<{ product_bundle_components: unknown }>)[0].product_bundle_components === null);
    eq('success: inputs not mutated', JSON.stringify([cats, prods, pricing, bundles]), snapshot);
    eq('success: fetchers called once each, in order', log, ['cats', 'prods', 'pricing', 'bundles']);
    eq('success: exactly four keys', Object.keys(actual), ['catsRes', 'prodsRes', 'pricingRes', 'bundlesRes']);
  }

  // 2. Fetchers are all invoked synchronously (before any awaited result), like Promise.all([...calls]).
  {
    const log: string[] = [];
    const pending = () => new Promise<Res>(() => { /* never resolves */ });
    void loadAdminResolverCatalogRowsWith({
      fetchCategories: () => { log.push('cats'); return pending(); },
      fetchProducts: () => { log.push('prods'); return pending(); },
      fetchPricing: () => { log.push('pricing'); return pending(); },
      fetchBundles: () => { log.push('bundles'); return pending(); },
    });
    eq('all four started synchronously, in order', log, ['cats', 'prods', 'pricing', 'bundles']);
  }

  // 3. Query-level errors are returned, not thrown, and never short-circuit the others.
  for (const which of ['cats', 'prods', 'pricing', 'bundles'] as const) {
    const good: Res = { data: [{ id: 'x' }], error: null };
    const bad: Res = { data: null, error: { message: `${which} failed` } };
    const results = { cats: good, prods: good, pricing: good, bundles: good };
    results[which] = bad;
    const log: string[] = [];
    const fakes = makeFakes(results, log);
    const actual = await loadAdminResolverCatalogRowsWith({
      fetchCategories: fakes.cats, fetchProducts: fakes.prods, fetchPricing: fakes.pricing, fetchBundles: fakes.bundles,
    });
    const expected = await oracle(makeFakes(results, []));
    eq(`error in ${which}: same as inline`, actual, expected);
    eq(`error in ${which}: all four still fetched`, log.length, 4);
    const key = { cats: 'catsRes', prods: 'prodsRes', pricing: 'pricingRes', bundles: 'bundlesRes' }[which] as 'catsRes';
    ok(`error in ${which}: error object passed through untouched`, actual[key] === bad);
  }

  // 4. Multiple errors are all returned.
  {
    const bad = (m: string): Res => ({ data: null, error: { message: m } });
    const results = { cats: bad('a'), prods: bad('b'), pricing: bad('c'), bundles: bad('d') };
    const fakes = makeFakes(results, []);
    const actual = await loadAdminResolverCatalogRowsWith({
      fetchCategories: fakes.cats, fetchProducts: fakes.prods, fetchPricing: fakes.pricing, fetchBundles: fakes.bundles,
    });
    eq('all four errors returned', [actual.catsRes.error, actual.prodsRes.error, actual.pricingRes.error, actual.bundlesRes.error],
      [{ message: 'a' }, { message: 'b' }, { message: 'c' }, { message: 'd' }]);
  }

  // 5. A thrown rejection propagates unchanged, exactly like Promise.all.
  for (const which of ['cats', 'prods', 'pricing', 'bundles'] as const) {
    const good: Res = { data: [], error: null };
    const boom = new Error(`${which} exploded`);
    const build = (rejectAt: string) => ({
      cats: () => (rejectAt === 'cats' ? Promise.reject(boom) : Promise.resolve(good)),
      prods: () => (rejectAt === 'prods' ? Promise.reject(boom) : Promise.resolve(good)),
      pricing: () => (rejectAt === 'pricing' ? Promise.reject(boom) : Promise.resolve(good)),
      bundles: () => (rejectAt === 'bundles' ? Promise.reject(boom) : Promise.resolve(good)),
    });
    let loaderErr: unknown = null;
    let oracleErr: unknown = null;
    const f = build(which);
    try {
      await loadAdminResolverCatalogRowsWith({ fetchCategories: f.cats, fetchProducts: f.prods, fetchPricing: f.pricing, fetchBundles: f.bundles });
    } catch (e) { loaderErr = e; }
    try { await oracle(build(which)); } catch (e) { oracleErr = e; }
    ok(`rejection in ${which}: same error object as the inline load`, loaderErr === boom && oracleErr === boom);
  }

  // 6. With two rejections, the first to reject wins (Promise.all semantics preserved).
  {
    const e1 = new Error('first');
    const e2 = new Error('second');
    let caught: unknown = null;
    try {
      await loadAdminResolverCatalogRowsWith({
        fetchCategories: () => Promise.reject(e1),
        fetchProducts: () => new Promise<Res>((_, reject) => setTimeout(() => reject(e2), 5)),
        fetchPricing: () => Promise.resolve({ data: [], error: null } as Res),
        fetchBundles: () => Promise.resolve({ data: [], error: null } as Res),
      });
    } catch (e) { caught = e; }
    ok('first rejection wins', caught === e1);
  }

  console.log(`Admin resolver catalog loader tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} loader test(s) failed`);
}

void run().catch((e) => { throw e; });
