// WP-19 / WP-20 (B13): one header row, the navigation links each kind of visitor sees, the menu state machine, and no stale header-height literals.
// PASS - LOCAL AUTOMATED. Layout at 320/360/390/tablet/desktop, landscape and with the keyboard (M-01..M-04, M-10) is REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync } from 'node:fs';
import { buildNavLinks, CLOSED_NAV, menuGroupPath, navMenuReducer, nextFocusIndex, type NavInput, type NavMenuState } from '../../core/navLinks';
import { HEADER_HEIGHT_PX, HEADER_OFFSET_PX, SCROLL_MARGIN_CSS } from '../../core/headerOffset';

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

// --- visibility matrix -------------------------------------------------------------------------------------------------------
const group = (id: string, title: string, slugs: string[]) => ({ id, title, category_slugs: slugs });
const G0: NavInput['menuGroups'] = [];
const G1 = [group('1', 'Tables & Chairs', ['tables', 'chairs'])];
const G2 = [...G1, group('2', 'Tents', ['tents'])];
type Who = { name: string; signedIn: boolean; isAdmin: boolean; isCrew: boolean; account: string[]; auth: 'login' | 'logout' };
const WHO: Who[] = [
  { name: 'guest', signedIn: false, isAdmin: false, isCrew: false, account: [], auth: 'login' },
  { name: 'customer', signedIn: true, isAdmin: false, isCrew: false, account: ['my-orders'], auth: 'logout' },
  { name: 'crew', signedIn: true, isAdmin: false, isCrew: true, account: ['my-orders', 'crew'], auth: 'logout' },
  { name: 'admin/master', signedIn: true, isAdmin: true, isCrew: false, account: ['my-orders', 'admin', 'crew'], auth: 'logout' },
];
for (const w of WHO) {
  for (const ee of [false, true]) {
    for (const [gName, groups] of [['0 groups', G0], ['1 group', G1], ['2 groups', G2]] as Array<[string, NavInput['menuGroups']]>) {
      const m = buildNavLinks({ signedIn: w.signedIn, isAdmin: w.isAdmin, isCrew: w.isCrew, eventEssentialsEnabled: ee, menuGroups: groups });
      const label = `${w.name} / add-ons ${ee ? 'on' : 'off'} / ${gName}`;
      eq(`${label}: account links`, m.account.map((l) => l.id), w.account);
      eq(`${label}: sign in/out`, m.auth, w.auth);
      const ids = m.primary.map((l) => l.id);
      eq(`${label}: primary links`, ids, ee ? ['inflatables', 'quote', 'addons', 'about'] : ['inflatables', 'quote', 'about']);
      const addOns = m.primary.find((l) => l.id === 'addons');
      if (ee && groups.length > 0) {
        ok(`${label}: Party Add-Ons is a dropdown with every group and "View all add-ons" last`, !!addOns?.children && addOns.children.length === groups.length + 1 && addOns.children[addOns.children.length - 1].id === 'addons-all' && addOns.children[addOns.children.length - 1].to === '/event-essentials');
      } else if (ee) {
        ok(`${label}: with no groups Party Add-Ons is a plain link`, !!addOns && addOns.children === undefined && addOns.to === '/event-essentials');
      }
    }
  }
}
const base: NavInput = { signedIn: false, isAdmin: false, isCrew: false, eventEssentialsEnabled: true, menuGroups: G2 };
eq('paths', buildNavLinks(base).primary.map((l) => l.to), ['/catalog', '/contact', '/event-essentials', '/about']);
eq('group paths carry the category slugs', buildNavLinks(base).primary[2].children?.map((c) => c.to), ['/event-essentials?categories=tables,chairs', '/event-essentials?categories=tents', '/event-essentials']);
eq('menuGroupPath', menuGroupPath({ category_slugs: ['a', 'b'] }), '/event-essentials?categories=a,b');
eq('a group with no title or no categories is not shown (no hard-coded names, no empty links)', buildNavLinks({ ...base, menuGroups: [group('x', '', ['a']), group('y', 'Empty', [])] }).primary[2].children, undefined);
eq('account paths', buildNavLinks({ ...base, signedIn: true, isAdmin: true }).account.map((l) => l.to), ['/my-orders', '/admin', '/crew']);

// role parity with the route guards
const app = read('src/App.tsx');
ok('my-orders is open to any signed-in role the nav shows it to', /path="my-orders"[\s\S]{0,200}allowedRoles=\{\['CUSTOMER', 'ADMIN', 'CREW', 'MASTER'\]\}/.test(app));
ok('admin route is admin/master only (nav: isAdmin)', /path="admin"[\s\S]{0,120}allowedRoles=\{\['ADMIN'\]\}/.test(app));
ok('crew route is admin or crew (nav: isAdmin || CREW)', /path="crew\/\*"[\s\S]{0,120}allowedRoles=\{\['ADMIN', 'CREW'\]\}/.test(app));

// --- menu state --------------------------------------------------------------------------------------------------------------
const step = (s: NavMenuState, ...types: string[]) => types.reduce((st, t) => navMenuReducer(st, { type: t } as any), s);
ok('everything starts closed', Object.values(CLOSED_NAV).every((v) => v === false));
eq('opening the drawer', step(CLOSED_NAV, 'toggleDrawer').drawerOpen, true);
eq('opening a dropdown closes the others', step(CLOSED_NAV, 'toggleAccount', 'toggleAddOns'), { ...CLOSED_NAV, addOnsOpen: true });
eq('the same toggle closes it again', step(CLOSED_NAV, 'toggleAddOns', 'toggleAddOns'), CLOSED_NAV);
eq('opening the drawer closes an open dropdown', step(CLOSED_NAV, 'toggleAddOns', 'toggleDrawer'), { ...CLOSED_NAV, drawerOpen: true });
eq('Add-Ons inside the drawer expands only while the drawer is open', [step(CLOSED_NAV, 'toggleDrawerAddOns').drawerAddOnsExpanded, step(CLOSED_NAV, 'toggleDrawer', 'toggleDrawerAddOns').drawerAddOnsExpanded], [false, true]);
for (const closer of ['escape', 'routeChanged', 'closeAll', 'resizedToDesktop']) {
  eq(`${closer} closes the drawer and its expanded list`, step(CLOSED_NAV, 'toggleDrawer', 'toggleDrawerAddOns', closer), CLOSED_NAV);
  eq(`${closer} closes an open dropdown`, step(CLOSED_NAV, 'toggleAccount', closer), CLOSED_NAV);
}
eq('a click outside closes the dropdowns', step(CLOSED_NAV, 'toggleAddOns', 'outsideClick'), CLOSED_NAV);
eq('a click outside does not touch the drawer (it has its own backdrop)', step(CLOSED_NAV, 'toggleDrawer', 'outsideClick').drawerOpen, true);
ok('closing something already closed returns the same state object (no extra render)', navMenuReducer(CLOSED_NAV, { type: 'routeChanged' }) === CLOSED_NAV);
eq('focus wraps forwards and backwards', [nextFocusIndex(2, 3, false), nextFocusIndex(0, 3, true), nextFocusIndex(0, 3, false), nextFocusIndex(2, 3, true)], [0, 2, 1, 1]);
eq('focus from outside the list starts at the first (or last going back); empty list gives -1', [nextFocusIndex(-1, 3, false), nextFocusIndex(-1, 3, true), nextFocusIndex(0, 0, false)], [0, 2, -1]);

// --- the header and the drawer, in source ------------------------------------------------------------------------------------------
const layout = read('src/components/common/Layout.tsx');
ok('header is ONE h-16 row (no wrapping second row), above content but below modals', /<header className="bg-white shadow-sm sticky top-0 z-40">/.test(layout) && /flex items-center h-16/.test(layout) && !/flex-wrap/.test(layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'))) && !/min-h-16 h-auto/.test(layout));
ok('menus close on route change and on growing past the phone layout', /routeChanged/.test(layout) && /min-width: 768px/.test(layout) && /resizedToDesktop/.test(layout));
ok('the cart link has an accessible name with the count; the hamburger reports expanded', /aria-label=\{cartCount > 0 \?/.test(layout) && /aria-expanded=\{nav\.drawerOpen\}/.test(layout) && /aria-controls="mobile-nav-drawer"/.test(layout));
ok('the footer links to Party Add-Ons when the page is enabled', /eventEssentialsEnabled && \(\n\s+<li>\n\s+<Link to="\/event-essentials"/.test(layout));
const drawer = read('src/components/common/nav/MobileDrawer.tsx');
ok('drawer: a dialog with its own scroll, contained overscroll, capped height', /role="dialog"/.test(drawer) && /aria-modal="true"/.test(drawer) && /max-h-\[100dvh\] overflow-y-auto overscroll-contain/.test(drawer) && /id="mobile-nav-drawer"/.test(drawer));
ok('drawer: closes on Escape, backdrop, X and link clicks; locks the page; traps and restores focus', /e\.key === 'Escape'/.test(drawer) && /aria-label="Close menu"/.test(drawer) && (drawer.match(/onClick=\{onClose\}/g) ?? []).length >= 4 && /useBodyScrollLock\(open\)/.test(drawer) && /nextFocusIndex\(/.test(drawer) && /returnFocusRef\.current\?\.focus/.test(drawer));
ok('drawer: 44px rows', /min-h-\[44px\]/.test(drawer));
const lock = read('src/hooks/core/useBodyScrollLock.ts');
ok('scroll lock restores exactly what it changed', /previousOverflow/.test(lock) && /body\.style\.overflow = previousOverflow/.test(lock) && /previousPadding/.test(lock));
const nav = read('src/components/common/nav/SiteNav.tsx') + read('src/components/common/nav/AccountMenu.tsx');
ok('dropdowns report aria-expanded and dismiss on outside click and Escape', (nav.match(/aria-expanded=\{/g) ?? []).length === 2 && (nav.match(/useDismissable\(/g) ?? []).length === 2);

// --- WP-19: no stale header literals ---------------------------------------------------------------------------------------------------
eq('header constants', [HEADER_HEIGHT_PX, HEADER_OFFSET_PX, SCROLL_MARGIN_CSS], [64, 80, 'calc(var(--site-header-height) + 1rem)']);
const css = read('src/index.css');
ok('the CSS variable and the scroll padding exist, and the variable is 64px (4rem)', /--site-header-height: 4rem;/.test(css) && /scroll-padding-top: calc\(var\(--site-header-height\) \+ 1rem\)/.test(css));
const STALE: Array<[string, RegExp]> = [
  ['src/components/admin/orders/AdminFloatingOrderHeader.tsx', /fixed top-16/],
  ['src/components/admin/orders/OrdersManager.tsx', /'pt-20'/],
  ['src/components/admin/orders/SingleOrderView.tsx', /'pt-20'/],
  ['src/pages/Admin.tsx', /'pt-20'/],
  ['src/components/quote/QuoteSummarySection.tsx', /lg:top-24/],
  ['src/components/checkout/CheckoutSummary.tsx', /lg:top-24/],
  ['src/components/event-essentials-catalog/CatalogCartSidebar.tsx', /lg:top-24/],
  ['src/pages/Quote.tsx', /scrollY - 100|scrollMarginTop: '100px'/],
  ['src/components/quote/EventDetailsSection.tsx', /scrollMarginTop: '120px'/],
  ['src/components/quote/ValidationErrorBanner.tsx', /scrollMarginTop: '100px'/],
];
for (const [file, re] of STALE) ok(`${file}: no hard-coded header offset left`, !re.test(read(file)));
ok('the offsets now come from the variable / shared constants', /top-\[var\(--site-header-height\)\]/.test(read('src/components/admin/orders/AdminFloatingOrderHeader.tsx')) && /HEADER_OFFSET_PX/.test(read('src/pages/Quote.tsx')) && (read('src/components/quote/QuoteSummarySection.tsx').match(/lg:top-\[calc\(var\(--site-header-height\)_\+_2rem\)\]/g) ?? []).length === 2);

console.log(`navigation: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} navigation test(s) failed`);
