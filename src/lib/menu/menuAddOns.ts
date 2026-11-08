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
  // Packages only: the package's real components and quantities, from the package definition (WP-P2-15 / F-31). A package whose contents cannot all
  // be resolved is EXCLUDED from the menu (D6), so every package built now has this; it is absent only on older saved menus, which render as before.
  components?: MenuPackageComponent[];
}

export interface MenuPackageComponent {
  name: string;
  quantity: number;
  // Inflatable components carry how the unit is rented in the package; products have none.
  mode?: 'dry' | 'water' | 'customer_choice';
}

interface ProductRow { id: string; name: string; image_url: string | null; active: boolean; public_visible: boolean; category_id: string | null; sort_order: number }
interface PricingRow { product_id: string; standalone_price_cents: number | null; addon_price_cents: number | null; standalone_enabled: boolean; addon_enabled: boolean; sort_order?: number }
// The component arrays come from fetchProductBundlesWithAllComponents (same relation select the Party Add-Ons page uses). They are optional so
// callers that did not load them (and older tests) keep working: no arrays = no contents list.
interface BundleProductComponentRow { quantity_per_bundle: number; inventory_products: { name: string; active?: boolean | null; public_visible?: boolean | null } | null }
interface BundleInflatableComponentRow { quantity_per_bundle: number; selection_mode: 'dry' | 'water' | 'customer_choice'; unit: { name: string; active?: boolean | null } | null }
interface BundleRow {
  id: string; name: string; image_url: string | null; active: boolean; public_visible: boolean; menu_visible: boolean; standalone_price_cents: number | null; addon_price_cents: number | null; standalone_enabled: boolean; addon_enabled: boolean; sort_order: number;
  product_bundle_components?: BundleProductComponentRow[] | null;
  package_inflatable_components?: BundleInflatableComponentRow[] | null;
}
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

// Resolves a package's components for the menu from the package definition. A package is only exported when EVERY component is a real,
// visible item with a positive whole quantity (WP-P2-15, owner decision D6): a partial list would read as the whole package. Otherwise the
// result says why, for the ADMIN message only; the reason may name the component and must never reach a customer-facing surface.
export type PackageResolution = { ok: true; components: MenuPackageComponent[] } | { ok: false; reason: string };

export function resolvePackageComponentsDetailed(b: Pick<BundleRow, 'product_bundle_components' | 'package_inflatable_components'>): PackageResolution {
  const products = b.product_bundle_components;
  const inflatables = b.package_inflatable_components;
  if (!Array.isArray(products) && !Array.isArray(inflatables)) return { ok: false, reason: 'its contents could not be loaded' };
  const out: MenuPackageComponent[] = [];
  const validQty = (q: unknown): q is number => typeof q === 'number' && Number.isInteger(q) && q > 0;
  for (const c of inflatables ?? []) {
    const u = c.unit;
    if (!u || !u.name) return { ok: false, reason: 'an inflatable component could not be read' };
    if (u.active !== true) return { ok: false, reason: `the inflatable "${u.name}" is inactive` };
    if (!validQty(c.quantity_per_bundle)) return { ok: false, reason: `"${u.name}" has an invalid quantity` };
    out.push({ name: u.name, quantity: c.quantity_per_bundle, mode: c.selection_mode });
  }
  for (const c of products ?? []) {
    const p = c.inventory_products;
    if (!p || !p.name) return { ok: false, reason: 'a product component could not be read' };
    if (p.active !== true) return { ok: false, reason: `the product "${p.name}" is inactive` };
    if (p.public_visible !== true) return { ok: false, reason: `the product "${p.name}" is not public` };
    if (!validQty(c.quantity_per_bundle)) return { ok: false, reason: `"${p.name}" has an invalid quantity` };
    out.push({ name: p.name, quantity: c.quantity_per_bundle });
  }
  return out.length > 0 ? { ok: true, components: out } : { ok: false, reason: 'it has no components defined' };
}

export function resolvePackageComponents(b: Pick<BundleRow, 'product_bundle_components' | 'package_inflatable_components'>): MenuPackageComponent[] | undefined {
  const r = resolvePackageComponentsDetailed(b);
  return r.ok ? r.components : undefined;
}

// A package left out of the exported menu (D6). Held only for the Admin message; never saved into the customer-visible menu data.
export interface OmittedMenuPackage { id: string; name: string; reason: string }

export function describeOmittedPackages(omitted: readonly OmittedMenuPackage[]): string {
  const lines = omitted.map((o) => `"${o.name}": ${o.reason}`);
  return `Left out of the menu export (incomplete package contents, nothing was changed): ${lines.join('; ')}. Fix the package in Admin, then export again.`;
}

const MODE_SUFFIX: Record<NonNullable<MenuPackageComponent['mode']>, string> = { dry: ' (dry)', water: ' (water)', customer_choice: ' (dry or water)' };

// One printed line per component: "2 × Folding Table", "1 × Castle (dry or water)".
export function packageComponentLine(c: MenuPackageComponent): string {
  return `${c.quantity} × ${c.name}${c.mode ? MODE_SUFFIX[c.mode] ?? '' : ''}`;
}

export function buildMenuAddOns(input: MenuAddOnInput): MenuAddOn[] {
  return buildMenuAddOnsWithReport(input).items;
}

export function buildMenuAddOnsWithReport({ products, pricing, bundles, categories }: MenuAddOnInput): { items: MenuAddOn[]; omittedPackages: OmittedMenuPackage[] } {
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

  // D6: a package whose contents cannot all be resolved is EXCLUDED (never shown with a hidden or partial list); the caller tells the Admin.
  const omittedPackages: OmittedMenuPackage[] = [];
  const packageRows = bundles
    .filter((b) => b.active && b.public_visible && b.menu_visible)
    .map((b) => ({ b, price: pickPrice(b) }))
    .filter((x): x is { b: BundleRow; price: NonNullable<ReturnType<typeof pickPrice>> } => x.price !== null)
    .sort((a, b) => a.b.sort_order - b.b.sort_order || a.b.name.localeCompare(b.b.name))
    .flatMap<MenuAddOn>(({ b, price }) => {
      const r = resolvePackageComponentsDetailed(b);
      if (!r.ok) { omittedPackages.push({ id: b.id, name: b.name, reason: r.reason }); return []; }
      return [{ id: b.id, kind: 'package', name: b.name, categoryName: 'Packages', priceCents: price.cents, priceKind: price.kind, imageUrl: b.image_url || null, components: r.components }];
    });

  return { items: [...productRows, ...packageRows], omittedPackages };
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
// Package cards are taller (they list their contents), so fewer fit on a printed page.
export const MENU_PACKAGE_PAGE_SIZE = 4;

// Party Add-Ons (products) and Party Packages are separate sections in the preview, PDF and PNG. Saved data holds one list, products first.
export function splitMenuAddOns<T extends Pick<MenuAddOn, 'kind'>>(items: readonly T[]): { products: T[]; packages: T[] } {
  return { products: items.filter((a) => a.kind !== 'package'), packages: items.filter((a) => a.kind === 'package') };
}

// ---- export file names (WP-P2-15 / F-32) -----------------------------------------------------------------------------------------
// The PDF name comes from document.title while printing; the image name is set on the saved file. Both use this one base so they match,
// e.g. "Bounce-Party-Club-Menu-2026-11-06" (date = the "Generated" date printed on the menu) plus a filter suffix for a filtered menu.
function slugPart(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function menuExportBaseName(opts: { generatedAtIso: string; activeFilter?: string | null; availabilityChecked?: boolean | null }): string {
  const d = new Date(opts.generatedAtIso);
  const stamp = Number.isNaN(d.getTime())
    ? ''
    : `-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parts = ['Bounce-Party-Club-Menu'];
  const filter = opts.activeFilter ? slugPart(opts.activeFilter) : '';
  if (filter) parts.push(filter);
  if (opts.availabilityChecked) parts.push('Available');
  return `${parts[0]}${stamp}${parts.slice(1).map((p) => `-${p}`).join('')}`;
}

// Retina (2x) unless that would pass the canvas area limit of mobile browsers (about 16.7 M px); then the scale shrinks to fit.
export const MENU_CANVAS_MAX_PIXELS = 16_000_000;
export function menuCanvasScale(widthPx: number, heightPx: number, preferred = 2): number {
  if (widthPx <= 0 || heightPx <= 0) return preferred;
  return Math.min(preferred, Math.sqrt(MENU_CANVAS_MAX_PIXELS / (widthPx * heightPx)));
}

// Splits a list into print pages of MENU_PAGE_SIZE (the same paging the inflatable cards use).
export function paginate<T>(items: readonly T[], size: number = MENU_PAGE_SIZE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}
