// WP-20 (B13): which navigation links a visitor sees, as plain data. Pure, so the visibility matrix (guest / customer / crew / admin x Party
// Add-Ons on or off x menu groups) is tested without a browser.
//
// Roles (they match the route guards in App.tsx): My Orders needs a signed-in user; Admin needs isAdmin (admin or master); Crew needs
// isAdmin or the CREW role. "Get Quote" goes to the inquiry form (/contact); the cart icon goes to /quote.

export interface NavLink {
  id: string;
  label: string;
  to: string;
  // Present only for a dropdown (Party Add-Ons with Admin-configured menu groups).
  children?: NavLink[];
}

export interface MenuGroupLike {
  id: string;
  title: string;
  category_slugs: string[];
}

export interface NavInput {
  signedIn: boolean;
  isAdmin: boolean;
  isCrew: boolean;
  eventEssentialsEnabled: boolean;
  menuGroups: MenuGroupLike[];
}

export interface NavModel {
  primary: NavLink[];
  account: NavLink[];
  auth: 'login' | 'logout';
}

export const ADD_ONS_PATH = '/event-essentials';

export function menuGroupPath(group: Pick<MenuGroupLike, 'category_slugs'>): string {
  return `${ADD_ONS_PATH}?categories=${group.category_slugs.join(',')}`;
}

export function buildNavLinks(input: NavInput): NavModel {
  const primary: NavLink[] = [
    { id: 'inflatables', label: 'Inflatables', to: '/catalog' },
    { id: 'quote', label: 'Get Quote', to: '/contact' },
  ];

  if (input.eventEssentialsEnabled) {
    const groups = input.menuGroups.filter((g) => g.title && g.category_slugs.length > 0);
    const addOns: NavLink = { id: 'addons', label: 'Party Add-Ons', to: ADD_ONS_PATH };
    if (groups.length > 0) {
      addOns.children = [
        ...groups.map((g) => ({ id: `group-${g.id}`, label: g.title, to: menuGroupPath(g) })),
        { id: 'addons-all', label: 'View all add-ons', to: ADD_ONS_PATH },
      ];
    }
    primary.push(addOns);
  }

  primary.push({ id: 'about', label: 'About Us', to: '/about' });

  const account: NavLink[] = [];
  if (input.signedIn) account.push({ id: 'my-orders', label: 'My Orders', to: '/my-orders' });
  if (input.isAdmin) account.push({ id: 'admin', label: 'Admin', to: '/admin' });
  if (input.isAdmin || input.isCrew) account.push({ id: 'crew', label: 'Crew', to: '/crew' });

  return { primary, account, auth: input.signedIn ? 'logout' : 'login' };
}

// ---- menu state ---------------------------------------------------------------------------------------------------------------------
export interface NavMenuState {
  drawerOpen: boolean;
  addOnsOpen: boolean;
  accountOpen: boolean;
  drawerAddOnsExpanded: boolean;
}

export const CLOSED_NAV: NavMenuState = { drawerOpen: false, addOnsOpen: false, accountOpen: false, drawerAddOnsExpanded: false };

export type NavMenuAction =
  | { type: 'toggleDrawer' }
  | { type: 'toggleAddOns' }
  | { type: 'toggleAccount' }
  | { type: 'toggleDrawerAddOns' }
  | { type: 'closeAll' }
  | { type: 'escape' }
  | { type: 'outsideClick' }
  | { type: 'routeChanged' }
  | { type: 'resizedToDesktop' };

// One thing open at a time; everything closes on Escape, a click outside, a route change, a link click and when the screen grows past the
// phone layout (so a drawer left open cannot trap the body scroll lock on a rotated tablet).
export function navMenuReducer(state: NavMenuState, action: NavMenuAction): NavMenuState {
  switch (action.type) {
    case 'toggleDrawer':
      return { ...CLOSED_NAV, drawerOpen: !state.drawerOpen };
    case 'toggleAddOns':
      return { ...CLOSED_NAV, addOnsOpen: !state.addOnsOpen };
    case 'toggleAccount':
      return { ...CLOSED_NAV, accountOpen: !state.accountOpen };
    case 'toggleDrawerAddOns':
      return state.drawerOpen ? { ...state, drawerAddOnsExpanded: !state.drawerAddOnsExpanded } : state;
    case 'closeAll':
    case 'escape':
    case 'routeChanged':
    case 'resizedToDesktop':
      return state.drawerOpen || state.addOnsOpen || state.accountOpen || state.drawerAddOnsExpanded ? CLOSED_NAV : state;
    case 'outsideClick':
      // A click outside closes the dropdowns; the drawer has its own backdrop that sends closeAll.
      return state.addOnsOpen || state.accountOpen ? { ...state, addOnsOpen: false, accountOpen: false } : state;
    default:
      return state;
  }
}

// Tab / Shift+Tab inside the drawer wraps around instead of leaving it.
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}
