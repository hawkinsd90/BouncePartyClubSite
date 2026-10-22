// WP-24 / WP-33 (B16): customer screens on small phones, and Party Add-Ons in the downloadable menu.
// PASS - LOCAL AUTOMATED (pure rules + source assertions). Layout at 320/360/390, a real menu print/PDF/image export, and device keyboards are
// REQUIRES HOSTED DEV VERIFICATION (G23, M-xx widths).
import { readFileSync } from 'node:fs';
import { addOnPriceLabel, buildMenuAddOns, MENU_PAGE_SIZE, paginate, shouldIncludeAddOns } from '../../menu/menuAddOns';
import { addPendingPhotos, MAX_PHOTO_BYTES, releaseAll, removePendingPhoto } from '../../portal/pendingPhotos';
import { quoteContinueState } from '../../booking/quoteContinueBar';
import { cartBarItemLabel, shouldShowCartBar } from '../../eventEssentials/catalogCartBar';
import { stepIndex, swipeDirection } from '../../core/swipe';
import { isLikelyInAppBrowser } from '../../auth/inAppBrowser';
import { isTabRendered, nextVisitedTabs } from '../../portal/customerPortalTab';

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

// =====================================================================================================================
// WP-24 completion pass: Quote bar, Party Add-Ons cart bar, portal, sign-in, unit page, toasts
// =====================================================================================================================
// --- Quote: Continue state ---
const ready = { hasTotals: true, pricingConfigError: null, isCalculating: false, depositError: null, submitting: false };
eq('Continue is enabled when totals are ready', quoteContinueState(ready), { disabled: false, label: 'Continue to Checkout →', reason: null });
eq('Continue is disabled and busy while availability is being re-checked (a second tap is ignored)', quoteContinueState({ ...ready, submitting: true }), { disabled: true, label: 'Checking availability...', reason: null });
ok('Continue says why it is disabled while pricing is calculating', quoteContinueState({ ...ready, hasTotals: false }).reason === 'Calculating your total...' && quoteContinueState({ ...ready, isCalculating: true }).disabled);
ok('Continue is disabled with a pricing explanation on a configuration or deposit error', quoteContinueState({ ...ready, pricingConfigError: 'x' }).reason?.includes('Pricing is unavailable') === true && quoteContinueState({ ...ready, depositError: 'y' }).disabled);
ok('submitting wins over the other states', quoteContinueState({ ...ready, hasTotals: false, submitting: true }).label === 'Checking availability...');

const quote = read('src/pages/Quote.tsx');
const summary = read('src/components/quote/QuoteSummarySection.tsx');
ok('Quote: the total and Continue are pinned to the bottom on phones, the card button shows on wide screens only', /data-testid="quote-mobile-bar"/.test(summary) && /lg:hidden fixed inset-x-0 bottom-0 z-30/.test(summary) && /hidden lg:block w-full/.test(summary) && /pb-\[calc\(0\.75rem\+env\(safe-area-inset-bottom\)\)\]/.test(summary) && (summary.match(/\{cont\.label\}/g) ?? []).length === 2);
ok('Quote: both Continue buttons share one rule', /quoteContinueState\(\{ hasTotals: !!totals, pricingConfigError, isCalculating, depositError: totals\?\.depositError, submitting \}\)/.test(summary) && (summary.match(/disabled=\{cont\.disabled\}/g) ?? []).length === 2);
ok('Quote: the page leaves room for the pinned bar', /pb-28 lg:pb-16/.test(quote));
ok('Quote: the error toast sits above the pinned bar, is announced, and has a 44px close', /bottom-\[calc\(5\.5rem\+env\(safe-area-inset-bottom\)\)\] lg:bottom-4/.test(quote) && /role="alert" aria-live="assertive" className="fixed bottom-/.test(quote) && /min-h-\[44px\] min-w-\[44px\]/.test(quote));
ok('Quote: Continue ignores a second press and shows progress while availability is re-checked', /if \(submitting\) return;/.test(quote) && /setSubmitting\(true\);[\s\S]{0,260}finally \{\s+setSubmitting\(false\);/.test(quote) && /submitting=\{submitting\}/.test(quote));
ok('Quote: scrolling to a field or section uses the shared header offset, not a literal 100', !/headerOffset = 100/.test(quote) && (quote.match(/absoluteTop - HEADER_OFFSET_PX/g) ?? []).length === 2);

// --- Party Add-Ons: cart bar and controls ---
eq('cart bar wording', [cartBarItemLabel(0), cartBarItemLabel(1), cartBarItemLabel(3), cartBarItemLabel(-2), cartBarItemLabel(2.9)], ['0 items', '1 item', '3 items', '0 items', '2 items']);
ok('cart bar shows only with something in the cart', !shouldShowCartBar(0) && shouldShowCartBar(1) && !shouldShowCartBar(-1));
const bar = read('src/components/event-essentials-catalog/CatalogMobileCartBar.tsx');
ok('Party Add-Ons: a pinned bar (phones only) shows the count, subtotal and View Quote', /lg:hidden fixed inset-x-0 bottom-0 z-30/.test(bar) && /cartBarItemLabel\(totalQty\)/.test(bar) && /formatPriceCents\(subtotalCents\)/.test(bar) && /min-h-\[48px\]/.test(bar) && /<CatalogMobileCartBar/.test(ee) && /pb-28 lg:pb-12/.test(ee));
ok('Party Add-Ons: quantity buttons, number boxes and Add are 44px, the row wraps, the keypad is numeric', (ee.match(/w-11 h-11/g) ?? []).length === 4 && !/w-8 h-8/.test(ee) && (ee.match(/inputMode="numeric" className="w-14 min-h-\[44px\]/g) ?? []).length === 2 && /flex flex-wrap items-center justify-between gap-3 mt-auto/.test(ee) && (ee.match(/px-4 min-h-\[44px\] py-2 bg-/g) ?? []).length === 2);
ok('Party Add-Ons: category chips are 44px', (read('src/components/event-essentials-catalog/CatalogCategoryTabs.tsx').match(/min-h-\[44px\]/g) ?? []).length === 2);

// --- Customer Portal ---
eq('photo tabs stay mounted once visited', [nextVisitedTabs([], 'pictures'), nextVisitedTabs(['pictures'], 'lot-pics'), nextVisitedTabs(['pictures'], 'pictures'), nextVisitedTabs([], 'payment'), nextVisitedTabs([], 'details')], [['pictures'], ['pictures', 'lot-pics'], ['pictures'], [], []]);
eq('rendering rule: the active tab, plus visited photo tabs', [isTabRendered('pictures', 'details', ['pictures']), isTabRendered('pictures', 'details', []), isTabRendered('payment', 'details', ['payment']), isTabRendered('payment', 'payment', []), isTabRendered('lot-pics', 'waiver', ['lot-pics'])], [true, false, false, true, true]);
const portal = read('src/components/customer-portal/RegularPortalView.tsx');
ok('Portal: tiles are two across on a phone', /grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3/.test(portal) && !/grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2/.test(portal));
ok('Portal: choosing a section scrolls to its content, but not on first load', /contentTopRef\.current\?\.scrollIntoView/.test(portal) && /firstTabRender/.test(portal) && /scrollMarginTop: SCROLL_MARGIN_CSS/.test(portal));
ok('Portal: picture screens keep their state while another tab is showing', /isTabRendered\('pictures', activeTab, visitedTabs\)/.test(portal) && /isTabRendered\('lot-pics', activeTab, visitedTabs\)/.test(portal) && (portal.match(/<div hidden=\{activeTab !== '(pictures|lot-pics)'\}>/g) ?? []).length === 2);
const pay = read('src/components/customer-portal/PaymentTab.tsx');
ok('Payment tab: Update Card is a 44px link on its own line on phones, apart from the Pay button', /flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between/.test(pay) && /text-sm font-semibold text-blue-700 hover:text-blue-900 underline min-h-\[44px\]/.test(pay) && /w-full min-h-\[48px\] mt-2 font-semibold/.test(pay));
const approved = read('src/components/customer-portal/ApprovalSuccessView.tsx');
ok('Approval received: the two buttons stack on a phone and are 48px', /flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center/.test(approved) && (approved.match(/min-h-\[48px\]/g) ?? []).length === 2 && /px-4 sm:px-8/.test(approved));
const canceled = read('src/pages/StripeCheckoutCanceled.tsx');
ok('Payment canceled: panel padding and stacked 48px buttons on a phone', /p-6 sm:p-10 text-center max-w-md w-full/.test(canceled) && /flex flex-col-reverse sm:flex-row/.test(canceled) && (canceled.match(/min-h-\[48px\]/g) ?? []).length === 2);

// --- nested padding on phones ---
for (const [file, token] of [
  ['src/components/checkout/ConsentSection.tsx', 'p-4 sm:p-6'],
  ['src/components/checkout/TipSection.tsx', 'p-4 sm:p-6'],
  ['src/components/quote/SetupDetailsSection.tsx', 'p-4 sm:p-6'],
  ['src/components/customer-portal/OrderStatusView.tsx', 'px-4 sm:px-8'],
  ['src/components/customer-portal/SecureAccessRequired.tsx', 'p-6 sm:p-10'],
  ['src/components/customer-portal/PortalLoadNotices.tsx', 'p-6 sm:p-10'],
  ['src/pages/About.tsx', 'p-4 sm:p-8'],
  ['src/pages/Home.tsx', 'p-4 sm:p-8'],
  ['src/components/checkout/BillingAddressForm.tsx', 'p-4 sm:p-6'],
] as Array<[string, string]>) {
  ok(`${file}: phone-sized padding (${token})`, read(file).includes(token));
}
ok('nothing in the customer pages still uses a bare p-8 / p-10 container', ['src/pages/Contact.tsx', 'src/pages/Sign.tsx', 'src/pages/About.tsx', 'src/components/customer-portal/OrderStatusView.tsx', 'src/components/customer-portal/SecureAccessRequired.tsx'].every((f) => !/className="[^"]*(?<![:\w-])(p-8|p-10)(?![\w-])[^"]*"/.test(read(f).replace(/className="[^"]*(hover:bg|font-bold|font-semibold)[^"]*"/g, ''))));

// --- sign-in and sign-up ---
eq('in-app browsers are recognised (Google refuses sign-in there)', [
  isLikelyInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]'),
  isLikelyInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0'),
  isLikelyInAppBrowser('Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36'),
  isLikelyInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),
  isLikelyInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),
  isLikelyInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'),
  isLikelyInAppBrowser('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'),
  isLikelyInAppBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'),
  isLikelyInAppBrowser(''), isLikelyInAppBrowser(null), isLikelyInAppBrowser(undefined),
], [true, true, true, true, false, false, false, false, false, false, false]);
const login = read('src/pages/Login.tsx');
ok('Login: the in-app-browser notice shows above Google and does not block it', /isLikelyInAppBrowser\(navigator\.userAgent\)/.test(login) && /\{inAppBrowser && \(/.test(login) && /IN_APP_BROWSER_NOTICE/.test(login) && !/disabled=\{loading \|\| inAppBrowser\}/.test(login));
ok('Login: labelled fields, 44px tap targets, honest show/hide label, buttons that do not submit the form', /htmlFor="login-email"/.test(login) && /id="login-email"/.test(login) && /htmlFor="login-password"/.test(login) && /id="login-password"/.test(login) && /'Hide password' : 'Show password'/.test(login) && (login.match(/min-h-\[44px\]/g) ?? []).length >= 5 && /type="button"\n\s+onClick=\{handleGoogleSignIn\}/.test(login));
const forgot = read('src/pages/ForgotPassword.tsx');
ok('Forgot password: a long email address wraps instead of overflowing; labelled field; phone-sized padding', /font-semibold break-all">\{email\}/.test(forgot) && /htmlFor="forgot-email"/.test(forgot) && !/p-6 sm:p-8/.test(forgot) && (forgot.match(/p-4 sm:p-8/g) ?? []).length === 2);
const signup = read('src/pages/SignUp.tsx');
ok('Sign up: name and business autofill hints', /autoComplete="given-name"/.test(signup) && /autoComplete="family-name"/.test(signup) && /autoComplete="organization"/.test(signup));
const billing = read('src/components/checkout/BillingAddressForm.tsx');
ok('Billing address: every field has a billing autofill hint and a label link; ZIP opens the number pad', ['billing address-line1', 'billing address-line2', 'billing address-level2', 'billing address-level1', 'billing postal-code'].every((t) => billing.includes(`autoComplete="${t}"`)) && ['billing-line1', 'billing-line2', 'billing-city', 'billing-state', 'billing-zip'].every((id) => billing.includes(`htmlFor="${id}"`) && billing.includes(`id="${id}"`)) && /inputMode="numeric"/.test(billing));
ok('Address search box: the browser saved-address list does not cover the suggestions', /autoComplete="off"\n\s+autoCorrect="off"/.test(read('src/components/order/AddressAutocomplete.tsx')));

// --- unit page ---
eq('swipe: far and mostly sideways counts; short, vertical or diagonal does not', [swipeDirection(200, 100, 100, 105), swipeDirection(100, 100, 200, 90), swipeDirection(100, 100, 130, 100), swipeDirection(100, 100, 190, 250), swipeDirection(100, 100, 100, 300)], ['next', 'prev', null, null, null]);
eq('stepping through photos wraps and stays inside the list', [stepIndex(0, 'prev', 4), stepIndex(3, 'next', 4), stepIndex(1, 'next', 4), stepIndex(9, 'next', 4), stepIndex(0, 'next', 0), stepIndex(-3, 'prev', 4)], [3, 0, 2, 0, 0, 3]);
const unit = read('src/pages/UnitDetail.tsx');
ok('Unit page: a failed load shows an error with Try again instead of a blank page', /const \[loadError, setLoadError\] = useState\(false\)/.test(unit) && /setLoadError\(true\);/.test(unit) && /We could not load this inflatable/.test(unit) && /onClick=\{\(\) => slug && loadUnit\(slug\)\}/.test(unit));
ok('Unit page: the photo viewer is a dialog that swipes, closes on Escape, locks page scroll and has a 48px labelled close', /role="dialog" aria-modal="true"/.test(unit) && /swipeDirection\(start\.x, start\.y, t\.clientX, t\.clientY\)/.test(unit) && /e\.key === 'Escape'/.test(unit) && /useBodyScrollLock\(isImageModalOpen\)/.test(unit) && /aria-label="Close photos"/.test(unit) && /min-h-\[48px\] min-w-\[48px\]/.test(unit));
ok('Unit page: long names and measurements wrap at 320', /break-words/.test(unit) && !/text-2xl sm:text-3xl font-bold text-slate-900">/.test(unit) && /p-4 sm:p-5/.test(unit));

// --- toasts ---
const toasts = read('src/lib/toasts.tsx');
ok('Toasts: below the site header, never wider than the screen, announced, 44px-reachable close, wrapping text', /top = 'calc\(var\(--site-header-height, 4rem\) \+ 0\.5rem\)'/.test(toasts) && /style\.left = '12px'/.test(toasts) && /role=\{type === 'error' \|\| type === 'warning' \? 'alert' : 'status'\}/.test(toasts) && /p-2 -m-2/.test(toasts) && /break-words/.test(toasts));
ok('Confirm dialog (showConfirm): phone padding, scrolls, 44px buttons', /p-4 sm:p-6 max-w-md mx-4 max-h-\[90dvh\] overflow-y-auto/.test(toasts) && (toasts.match(/min-h-\[44px\]/g) ?? []).length === 2);

console.log(`customerScreens: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} customer screen test(s) failed`);
