// Customer Portal tab resolution — URL as single source of truth.
//
// The active tab is derived from the current URL search params on every render.
// No separate useState mirrors the tab. Clicking a section navigates with
// setSearchParams (push, not replace). Browser Back/Forward change the URL,
// which changes the resolved tab automatically.

export type PortalTabKey =
  | 'details'
  | 'lot-pics'
  | 'waiver'
  | 'payment'
  | 'pictures'
  | 'delivery';

export const CANONICAL_TAB_KEYS: readonly PortalTabKey[] = [
  'details',
  'lot-pics',
  'waiver',
  'payment',
  'pictures',
  'delivery',
];

const TAB_ALIASES: Record<string, PortalTabKey> = {
  'lot-pictures': 'lot-pics',
};

export interface PortalNavSection {
  key: PortalTabKey;
  locked: boolean;
}

function normalizeTabKey(raw: string | null | undefined): PortalTabKey | null {
  if (!raw) return null;
  if (TAB_ALIASES[raw]) return TAB_ALIASES[raw];
  if ((CANONICAL_TAB_KEYS as readonly string[]).includes(raw)) {
    return raw as PortalTabKey;
  }
  return null;
}

export function resolveCustomerPortalTab(input: {
  requestedTab: string | null | undefined;
  sections: PortalNavSection[];
}): PortalTabKey {
  const normalized = normalizeTabKey(input.requestedTab);
  if (!normalized) return 'details';

  const section = input.sections.find(s => s.key === normalized);
  if (!section) return 'details';
  if (section.locked) return 'details';

  return normalized;
}

export function buildTabUrlParam(tab: PortalTabKey): string | null {
  if (tab === 'details') return null;
  return tab;
}

// Tabs whose screen holds work in progress (photos picked but not yet sent, an upload under way). Switching away unmounted them and the
// customer lost it, so once visited they stay in the page (hidden) while another tab is showing.
export const KEEP_MOUNTED_TABS: readonly PortalTabKey[] = ['lot-pics', 'pictures'];

export function nextVisitedTabs(visited: readonly PortalTabKey[], activeTab: PortalTabKey): readonly PortalTabKey[] {
  if (!KEEP_MOUNTED_TABS.includes(activeTab) || visited.includes(activeTab)) return visited;
  return [...visited, activeTab];
}

export function isTabRendered(tab: PortalTabKey, activeTab: PortalTabKey, visited: readonly PortalTabKey[]): boolean {
  return tab === activeTab || (KEEP_MOUNTED_TABS.includes(tab) && visited.includes(tab));
}
