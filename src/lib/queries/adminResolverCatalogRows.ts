// Shared raw load of the four admin catalog queries the Event Essentials resolver
// needs: product categories, inventory products, product pricing, and bundles with
// their configuration.
//
// The same `Promise.all([categories, products, pricing, bundles])` appeared verbatim in
// InvoiceBuilder, OrderDetailModal and AddEventEssentialsSection. This function owns
// ONLY that parallel load. It returns the four raw query results, unchanged and in
// that order (`{ catsRes, prodsRes, pricingRes, bundlesRes }`), and decides nothing:
// - it does not inspect or throw on `.error` (each caller keeps its own handling:
//   InvoiceBuilder and OrderDetailModal check all four and toast; AddEventEssentialsSection
//   throws the first error's message),
// - it does not apply `|| []` to `.data`, filter, normalize or map anything,
// - it does not cache, and it does not catch (a rejected fetch rejects this call, so it
//   reaches the caller's existing try/catch).
//
// The four fetchers are invoked synchronously, in that order, exactly as the inline
// Promise.all did. The only timing difference is one extra async hop before the caller
// resumes, which the callers' stale-request checks already tolerate (they run after
// the await either way).
//
// The fetchers are injected so this module has no runtime imports and can be tested
// from Node. `loadAdminResolverCatalogRows` (in ./products) binds the real queries.

export interface AdminResolverCatalogFetchers<C, P, R, B> {
  fetchCategories: () => Promise<C>;
  fetchProducts: () => Promise<P>;
  fetchPricing: () => Promise<R>;
  fetchBundles: () => Promise<B>;
}

export async function loadAdminResolverCatalogRowsWith<C, P, R, B>(
  fetchers: AdminResolverCatalogFetchers<C, P, R, B>,
): Promise<{ catsRes: C; prodsRes: P; pricingRes: R; bundlesRes: B }> {
  const [catsRes, prodsRes, pricingRes, bundlesRes] = await Promise.all([
    fetchers.fetchCategories(),
    fetchers.fetchProducts(),
    fetchers.fetchPricing(),
    fetchers.fetchBundles(),
  ]);
  return { catsRes, prodsRes, pricingRes, bundlesRes };
}
