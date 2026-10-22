// WP-24 / WP-33 (B16): customer screens on small phones, and Party Add-Ons in the downloadable menu.
// PASS - LOCAL AUTOMATED (pure rules + source assertions). Layout at 320/360/390, a real menu print/PDF/image export, and device keyboards are
// REQUIRES HOSTED DEV VERIFICATION (G23, M-xx widths).
import { readFileSync } from 'node:fs';
import { addOnPriceLabel, buildMenuAddOns, MENU_PAGE_SIZE, paginate, shouldIncludeAddOns } from '../../menu/menuAddOns';
import { addPendingPhotos, MAX_PHOTO_BYTES, releaseAll, removePendingPhoto } from '../../portal/pendingPhotos';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// =====================================================================================================================
// WP-33: add-ons in the menu
// =====================================================================================================================
const cats = [
  { id: 'c-tables', name: 'Tables', sort_order: 2, active: true, public_visible: true },
  { id: 'c-chairs', name: 'Chairs', sort_order: 1, active: true, public_visible: true },
  { id: 'c-hidden', name: 'Hidden', sort_order: 0, active: true, public_visible: false },
  { id: 'c-retired', name: 'Retired', sort_order: 0, active: false, public_visible: true },
];
const prod = (id: string, name: string, category: string | null, extra: Record<string, unknown> = {}) => ({ id, name, image_url: `https://img/${id}.jpg`, active: true, public_visible: true, category_id: category, sort_order: 0, ...extra });
const price = (product_id: string, standalone: number | null, addon: number | null, se = standalone != null, ae = addon != null) => ({ product_id, standalone_price_cents: standalone, addon_price_cents: addon, standalone_enabled: se, addon_enabled: ae });
const pkg = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, image_url: null, active: true, public_visible: true, menu_visible: true, standalone_price_cents: 20000, addon_price_cents: null, standalone_enabled: true, addon_enabled: false, sort_order: 0, ...extra });

{
  const out = buildMenuAddOns({
    products: [
      prod('p-table', '8ft Table', 'c-tables'),
      prod('p-chair', 'Folding Chair', 'c-chairs'),
      prod('p-chair2', 'Chair Cover', 'c-chairs', { sort_order: 5 }),
      prod('p-inactive', 'Old Table', 'c-tables', { active: false }),
      prod('p-private', 'Private Item', 'c-tables', { public_visible: false }),
      prod('p-hiddencat', 'In Hidden Category', 'c-hidden'),
      prod('p-retiredcat', 'In Retired Category', 'c-retired'),
      prod('p-noprice', 'No Price', 'c-tables'),
      prod('p-disabled', 'Price Disabled', 'c-tables'),
      prod('p-addononly', 'Add-on Only', 'c-tables'),
      prod('p-nocat', 'No Category', null),
    ],
    pricing: [price('p-table', 7500, null), price('p-chair', 300, null), price('p-chair2', 100, null), price('p-inactive', 1, null), price('p-private', 1, null), price('p-hiddencat', 1, null), price('p-retiredcat', 1, null), price('p-disabled', 5000, null, false, false), price('p-addononly', null, 1200), price('p-nocat', 900, null)],
    bundles: [pkg('b-party', 'Party Package'), pkg('b-hidden', 'Not On Menu', { menu_visible: false }), pkg('b-off', 'Inactive Package', { active: false }), pkg('b-private', 'Private Package', { public_visible: false }), pkg('b-noprice', 'Free Package', { standalone_price_cents: 0, standalone_enabled: true })],
    categories: cats,
  });
  eq('shown add-ons, in category order (Chairs before Tables), then by product order, then packages last', out.map((a) => a.name), ['Folding Chair', 'Chair Cover', '8ft Table', 'Add-on Only', 'No Category', 'Party Package']);
  ok('inactive, private, hidden/retired category, unpriced and price-disabled products are excluded', !out.some((a) => ['Old Table', 'Private Item', 'In Hidden Category', 'In Retired Category', 'No Price', 'Price Disabled'].includes(a.name)));
  ok('only menu-visible, active, public packages with a price are included', out.filter((a) => a.kind === 'package').map((a) => a.name).join() === 'Party Package');
  eq('a product with only an add-on price shows that price, labelled as an add-on price', [out.find((a) => a.name === 'Add-on Only')?.priceCents, out.find((a) => a.name === 'Add-on Only')?.priceKind, addOnPriceLabel({ priceKind: 'add-on' }), addOnPriceLabel({ priceKind: 'standalone' })], [1200, 'add-on', 'Add-on price', 'Price']);
  eq('standalone price wins when both exist', buildMenuAddOns({ products: [prod('x', 'X', null)], pricing: [price('x', 500, 400)], bundles: [], categories: [] })[0].priceCents, 500);
  eq('category names ride along; packages are filed under Packages', [out[0].categoryName, out[out.length - 1].categoryName, out.find((a) => a.name === 'No Category')?.categoryName], ['Chairs', 'Packages', null]);
  eq('nothing to show gives an empty list', buildMenuAddOns({ products: [], pricing: [], bundles: [], categories: [] }), []);
}
eq('add-ons only on the plain full menu with the page enabled', [
  shouldIncludeAddOns({ eventEssentialsEnabled: true, filterType: 'all', availabilityChecked: false }),
  shouldIncludeAddOns({ eventEssentialsEnabled: false, filterType: 'all', availabilityChecked: false }),
  shouldIncludeAddOns({ eventEssentialsEnabled: true, filterType: 'slide', availabilityChecked: false }),
  shouldIncludeAddOns({ eventEssentialsEnabled: true, filterType: 'all', availabilityChecked: true }),
], [true, false, false, false]);
eq('paging uses the same page size as the inflatable cards', [MENU_PAGE_SIZE, paginate([1, 2, 3, 4, 5, 6, 7]).map((p) => p.length), paginate([]).length], [6, [6, 1], 0]);

const catalog = read('src/pages/Catalog.tsx');
const preview = read('src/pages/MenuPreview.tsx');
ok('catalog: the menu data carries addOns, loaded when the menu is saved', /const addOns = await loadMenuAddOns\(\);/.test(catalog) && /addOns,\n\s+availabilityChecked/.test(catalog) && /handleExportMenu = async \(\)/.test(catalog));
ok('catalog: a failure loading add-ons never blocks the menu (empty list and a notice)', /notifyError\('Party Add-Ons could not be included in the menu this time\.'\);\n\s+return \[\];/.test(catalog));
ok('catalog: add-ons honour the Party Add-Ons page setting and the plain-menu rule', /shouldIncludeAddOns\(\{ eventEssentialsEnabled: settings\.event_essentials_page_enabled, filterType, availabilityChecked \}\)/.test(catalog));
ok('catalog: uses the existing public product queries (active + public visible only)', /fetchInventoryProducts\(\), fetchProductPricing\(\), fetchProductBundles\(\), fetchProductCategories\(\)/.test(catalog));
ok('menu preview screen/print: an add-ons section with its own heading, paged like the cards, after the units', /menu-addons-title/.test(preview) && /paginate\(data\.addOns \?\? \[\]\)/.test(preview) && preview.indexOf('menu-print-addons') > preview.indexOf('menu-print-page-group') && /menu-print-page-break/.test(preview.slice(preview.indexOf('menu-print-addons'))));
ok('menu preview: the last inflatable page breaks before the add-ons', /pageIdx < pages\.length - 1 \|\| \(data\.addOns \?\? \[\]\)\.length > 0/.test(preview));
ok('menu preview image export: the canvas grows for the add-on rows and draws them before the footer', /const TOTAL_H = HEADER_H \+ PAD \+ GRID_H \+ PAD \+ ADDON_SECTION_H \+ FOOTER_H;/.test(preview) && preview.indexOf('// --- Party Add-Ons ---') < preview.indexOf('// --- Footer ---') && /const fy = HEADER_H \+ PAD \+ GRID_H \+ PAD \+ ADDON_SECTION_H;/.test(preview));
ok('menu preview: add-on images are loaded for the image export and preloaded for print', /addOns\.map\(\(a\) => loadImageForCanvas\(a\.imageUrl \?\? ''\)\)/.test(preview) && /\.\.\.\(data\.addOns \?\? \[\]\)\.map\(\(a\) => a\.imageUrl \?\? ''\)/.test(preview));
ok('menu preview: an older saved menu without addOns renders exactly as before', /const addOns = data\.addOns \?\? \[\];\n\s+const ADDON_HEADING_H = addOns\.length > 0 \? 56 : 0;/.test(preview) && /addOns\?: MenuAddOn\[\]/.test(preview));
const css = read('src/index.css');
ok('css: screen and print styles for the add-ons heading exist', /\.menu-preview-route \.menu-addons-title/.test(css) && /body\.print-menu-preview #root \.menu-addons-title/.test(css));

// =====================================================================================================================
// WP-24
// =====================================================================================================================
ok('catalog heading: wraps, breaks long words and shrinks on the narrowest phones (Save Menu no longer overflows)', /flex flex-wrap items-start justify-between gap-3/.test(catalog) && /min-w-0 break-words text-3xl/.test(catalog));

// picked photos
{
  let n = 0;
  const revoked: string[] = [];
  const deps = { createUrl: (f: File) => `blob:${f.name}`, newId: () => `id${++n}` };
  const f = (name: string, size = 1000, type = 'image/jpeg') => ({ name, size, type }) as any as File;
  const r1 = addPendingPhotos([], [f('a.jpg'), f('b.jpg'), f('c.jpg')], deps);
  eq('each pick is one record with its own preview', r1.items.map((p) => [p.id, p.file.name, p.url]), [['id1', 'a.jpg', 'blob:a.jpg'], ['id2', 'b.jpg', 'blob:b.jpg'], ['id3', 'c.jpg', 'blob:c.jpg']]);
  const r2 = removePendingPhoto(r1.items, 'id2', (u) => revoked.push(u));
  eq('removing one photo removes exactly that file and its preview (never a different photo)', [r2.map((p) => p.file.name), revoked], [['a.jpg', 'c.jpg'], ['blob:b.jpg']]);
  eq('removing an unknown id changes nothing and revokes nothing', [removePendingPhoto(r2, 'nope', (u) => revoked.push(u)).length, revoked.length], [2, 1]);
  const r3 = addPendingPhotos(r2, [f('big.jpg', MAX_PHOTO_BYTES + 1), f('doc.pdf', 10, 'application/pdf'), f('ok.png', 10, 'image/png')], deps);
  eq('oversized and non-image files are reported and skipped; the rest are added after the existing ones', [r3.tooLarge, r3.notImages, r3.items.map((p) => p.file.name)], [['big.jpg'], ['doc.pdf'], ['a.jpg', 'c.jpg', 'ok.png']]);
  const rel: string[] = [];
  releaseAll(r3.items, (u) => rel.push(u));
  eq('releaseAll revokes every preview', rel, ['blob:a.jpg', 'blob:c.jpg', 'blob:ok.png']);
  eq('exactly 10 MB is allowed', addPendingPhotos([], [f('edge.jpg', MAX_PHOTO_BYTES)], deps).items.length, 1);
}
const pics = read('src/components/customer-portal/PicturesTab.tsx');
ok('pictures tab: no FileReader/base64 previews and no parallel preview list', !/FileReader|readAsDataURL|previewUrls|selectedFiles/.test(pics) && /createObjectURL/.test(pics) && /revokeObjectURL/.test(pics));
ok('pictures tab: remove is by id and always visible (no hover-only control), 44px', /handleRemoveImage\(p\.id\)/.test(pics) && !/group-hover:opacity-100/.test(pics) && /w-11 h-11/.test(pics));
ok('pictures tab: submit sends the files of the records, then clears and releases them', /onSubmit\(selected\.map\(\(p\) => p\.file\), pictureNotes\)/.test(pics) && /releaseAll\(selected/.test(pics));
const lot = read('src/components/customer-portal/LotPicturesTab.tsx');
ok('lot pictures: the viewer\'s close button sits inside the screen and is 44px (it was above the image, off-screen on phones)', /absolute top-2 right-2 z-10 w-11 h-11/.test(lot) && !/-top-12/.test(lot) && /aria-label="Close picture"/.test(lot));

// forms
for (const [file, tokens] of [
  ['src/pages/Login.tsx', ['autoComplete="email"', 'autoComplete="current-password"']],
  ['src/pages/SignUp.tsx', ['autoComplete="email"', 'autoComplete="tel"', 'autoComplete="new-password"']],
  ['src/pages/ForgotPassword.tsx', ['autoComplete="email"']],
  ['src/pages/ResetPassword.tsx', ['autoComplete="new-password"']],
  ['src/pages/Contact.tsx', ['autoComplete="email"', 'autoComplete="tel"']],
  ['src/components/checkout/ContactInformationForm.tsx', ['autoComplete="email"', 'autoComplete="tel"']],
  ['src/components/shared/CustomerFormFields.tsx', ['autoComplete="email"', 'autoComplete="tel"']],
] as Array<[string, string[]]>) {
  const t = read(file);
  ok(`${file}: ${tokens.join(', ')}`, tokens.every((x) => t.includes(x)));
}
ok('phone and email boxes bring up the right keyboard', /inputMode="tel"/.test(read('src/pages/Contact.tsx')) && /inputMode="email"/.test(read('src/pages/Login.tsx')));
ok('every password box in sign-in, sign-up and reset has an autocomplete hint', (read('src/pages/SignUp.tsx').match(/autoComplete="new-password"/g) ?? []).length >= 2 && (read('src/pages/ResetPassword.tsx').match(/autoComplete="new-password"/g) ?? []).length >= 2);

// scroll + padding + filters
const app = read('src/App.tsx');
ok('a page change scrolls to the top (not for anchors), keyed on the path only', /function ScrollToTop\(\)/.test(app) && /if \(!hash\) window\.scrollTo\(0, 0\);\n\s+\}, \[pathname\]\);/.test(app) && /<ScrollToTop \/>/.test(app));
ok('nested panels use phone-sized padding', /p-4 sm:p-8">/.test(read('src/pages/Contact.tsx')) && /className="p-4 sm:p-8 space-y-8"/.test(read('src/pages/Sign.tsx')));
const ee = read('src/pages/EventEssentialsCatalog.tsx');
ok('Party Add-Ons category chips replace history instead of adding an entry per tap', (ee.match(/\}, \{ replace: true \}\);/g) ?? []).length === 2);

ok('Party Add-Ons: date fields stack on the narrowest phones and product images load lazily', /grid-cols-1 min-\[420px\]:grid-cols-2/.test(read('src/components/event-essentials-catalog/EventDatesCard.tsx')) && /loading="lazy"/.test(read('src/components/event-essentials-catalog/ProductImage.tsx')));

console.log(`customerScreens: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} customer screen test(s) failed`);
