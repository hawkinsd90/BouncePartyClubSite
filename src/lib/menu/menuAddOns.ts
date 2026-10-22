// WP-33 / NI-12 (B16): Party Add-Ons (Event Essentials) in the downloadable menu.
//
// The menu is generated in the browser from public catalog data. Add-ons join it as one more section using the same card layout. Only what the
// public Party Add-Ons page would show is included: active and publicly visible, in an active and visible category, with an enabled price.
// Packages are included only when the Admin marked them "menu visible".

export interface MenuAddOn {
  id: string;
  kind: 'product' | 'package';
  name: string;
  categoryName: string | null;
  priceCents: number;
  // How the price applies: 'standalone' (ordered on its own) or 'add-on' (only with an inflatable order).
  priceKind: 'standalone' | 'add-on';
  imageUrl: string | null;
}

interface ProductRow { id: string; name: string; image_url: string | null; active: boolean; public_visible: boolean; category_id: string | null; sort_order: number }
interface PricingRow { product_id: string; standalone_price_cents: number | null; addon_price_cents: number | null; standalone_enabled: boolean; addon_enabled: boolean; sort_order?: number }
interface BundleRow { id: string; name: string; image_url: string | null; active: boolean; public_visible: boolean; menu_visible: boolean; standalone_price_cents: number | null; addon_price_cents: number | null; standalone_enabled: boolean; addon_enabled: boolean; sort_order: number }
interface CategoryRow { id: string; name: string; sort_order: number; active?: boolean; public_visible?: boolean }

export interface MenuAddOnInput {
  products: ProductRow[];
  pricing: PricingRow[];
  bundles: BundleRow[];
  categories: CategoryRow[];
}

function pickPrice(p: { standalone_price_cents: number | null; addon_price_cents: number | null; standalone_enabled: boolean; addon_enabled: boolean }): { cents: number; kind: 'standalone' | 'add-on' } | null {
  if (p.standalone_enabled && typeof p.standalone_price_cents === 'number' && p.standalone_price_cents > 0) return { cents: p.standalone_price_cents, kind: 'standalone' };
  if (p.addon_enabled && typeof p.addon_price_cents === 'number' && p.addon_price_cents > 0) return { cents: p.addon_price_cents, kind: 'add-on' };
  return null;
}

export function buildMenuAddOns({ products, pricing, bundles, categories }: MenuAddOnInput): MenuAddOn[] {
  const visibleCategories = new Map(categories.filter((c) => c.active !== false && c.public_visible !== false).map((c) => [c.id, c]));
  const pricingByProduct = new Map(pricing.map((p) => [p.product_id, p]));

  const productRows = products
    .filter((p) => p.active && p.public_visible)
    // a product in a hidden or retired category is not shown publicly; a product with no category stays
    .filter((p) => !p.category_id || visibleCategories.has(p.category_id))
    .map((p) => {
      const price = pricingByProduct.get(p.id) ? pickPrice(pricingByProduct.get(p.id)!) : null;
      return price ? { p, price, category: p.category_id ? visibleCategories.get(p.category_id)! : null } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) =>
      (a.category?.sort_order ?? 1e9) - (b.category?.sort_order ?? 1e9) ||
      (a.category?.name ?? '').localeCompare(b.category?.name ?? '') ||
      a.p.sort_order - b.p.sort_order ||
      a.p.name.localeCompare(b.p.name))
    .map<MenuAddOn>(({ p, price, category }) => ({ id: p.id, kind: 'product', name: p.name, categoryName: category?.name ?? null, priceCents: price.cents, priceKind: price.kind, imageUrl: p.image_url || null }));

  const packageRows = bundles
    .filter((b) => b.active && b.public_visible && b.menu_visible)
    .map((b) => ({ b, price: pickPrice(b) }))
    .filter((x): x is { b: BundleRow; price: NonNullable<ReturnType<typeof pickPrice>> } => x.price !== null)
    .sort((a, b) => a.b.sort_order - b.b.sort_order || a.b.name.localeCompare(b.b.name))
    .map<MenuAddOn>(({ b, price }) => ({ id: b.id, kind: 'package', name: b.name, categoryName: 'Packages', priceCents: price.cents, priceKind: price.kind, imageUrl: b.image_url || null }));

  return [...productRows, ...packageRows];
}

// Add-ons ride along only on the plain "everything" menu. A filtered menu (Water Slides only) or one checked for a date would list items that
// were not filtered or whose availability was not checked, so those exports stay exactly as they were.
export function shouldIncludeAddOns(opts: { eventEssentialsEnabled: boolean; filterType: string; availabilityChecked: boolean }): boolean {
  return opts.eventEssentialsEnabled && opts.filterType === 'all' && !opts.availabilityChecked;
}

export function addOnPriceLabel(a: Pick<MenuAddOn, 'priceKind'>): string {
  return a.priceKind === 'add-on' ? 'Add-on price' : 'Price';
}

export const MENU_PAGE_SIZE = 6;

// Splits a list into print pages of MENU_PAGE_SIZE (the same paging the inflatable cards use).
export function paginate<T>(items: readonly T[], size: number = MENU_PAGE_SIZE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}
