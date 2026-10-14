// Differential tests for the pure order-list model (ordersListModel.ts).
//
// The `oracle*` functions are verbatim copies of the OrdersManager memos and default-tab effect body as they
// stood before the extraction (with `orders`/`now`/state passed in as arguments). They never call the new
// module. Old and new always run in the SAME process under the SAME time zone, so the known date quirks
// (date-only strings parsed as UTC but compared with local midnight, and a different noon parse for the
// cancelled sort) are compared, not normalized. The suite is repeated under several time zones when the
// runtime honours a TZ change, and the quirk itself is pinned by hand.

import { format } from 'date-fns';
import { formatOrderId } from '../../utils';
import { ORDER_STATUS } from '../../constants/statuses';
import { categorizeOrders, filterAndSortOrders, computeTabCounts, pickDefaultTab } from '../../ordersListModel';
import type { OrderTab } from '../../ordersListModel';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The app tsconfig has no Node typings; this test only runs under Node (jiti).
declare const process: { env: Record<string, string | undefined> };

let passed = 0;
let failed = 0;
let compared = 0;

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Map && b instanceof Map) return a.size === b.size && Array.from(a.keys()).every((k) => same(a.get(k), b.get(k)));
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// ---------------------------------------------------------------------------
// ORACLE: verbatim old code
// ---------------------------------------------------------------------------
function oracleCategorize(orders: any[], now: Date) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const categories = {
    draft: [] as any[],
    pending_review: [] as any[],
    awaiting_customer_approval: [] as any[],
    current: [] as any[],
    upcoming: [] as any[],
    past: [] as any[],
    cancelled: [] as any[],
    all: orders,
  };

  orders.forEach(order => {
    const eventDate = new Date(order.event_date);

    if (order.status === ORDER_STATUS.DRAFT) {
      categories.draft.push(order);
    } else if (order.status === ORDER_STATUS.PENDING) {
      categories.pending_review.push(order);
    } else if (order.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL) {
      categories.awaiting_customer_approval.push(order);
    } else if (order.status === ORDER_STATUS.CANCELLED) {
      categories.cancelled.push(order);
    }

    const isExcludedStatus =
      order.status === ORDER_STATUS.CANCELLED ||
      order.status === ORDER_STATUS.PENDING ||
      order.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL ||
      order.status === ORDER_STATUS.DRAFT;

    if (!isExcludedStatus) {
      if (eventDate >= todayStart && eventDate < todayEnd) {
        categories.current.push(order);
      } else if (eventDate >= todayEnd) {
        categories.upcoming.push(order);
      } else {
        categories.past.push(order);
      }
    }
  });

  categories.cancelled.sort((a: any, b: any) =>
    new Date(b.event_date + 'T12:00:00').getTime() - new Date(a.event_date + 'T12:00:00').getTime()
  );

  return categories;
}

function oracleFilter(categorizedOrders: any, activeTab: string, showArchived: boolean, searchTerm: string, sortColumn: string | null, sortDirection: 'asc' | 'desc', contactsMap: Map<string, any>) {
  let filtered = categorizedOrders[activeTab as keyof typeof categorizedOrders] || [];

  if ((activeTab === 'past' || activeTab === 'cancelled') && !showArchived) {
    filtered = filtered.filter((o: any) => !o.archived_at);
  }

  const search = searchTerm.toLowerCase();
  if (search) {
    filtered = filtered.filter((order: any) => {
      const customerName = `${order.customers?.first_name} ${order.customers?.last_name}`.toLowerCase();
      const email = order.customers?.email?.toLowerCase() || '';
      const phone = order.customers?.phone?.toLowerCase() || '';
      const eventDate = format(new Date(order.event_date), 'yyyy-MM-dd');
      const orderId = formatOrderId(order.id).toLowerCase();

      return customerName.includes(search) ||
             email.includes(search) ||
             phone.includes(search) ||
             eventDate.includes(search) ||
             orderId.includes(search);
    });
  }

  if (sortColumn) {
    const direction = sortDirection;
    const getSortValue = (order: any): string | null => {
      switch (sortColumn) {
        case 'id':
          return formatOrderId(order.id);
        case 'created_at':
          return order.created_at || null;
        case 'customer': {
          const biz = contactsMap.get(order.customers?.email)?.business_name;
          if (biz && biz.trim()) return biz.trim();
          const first = order.customers?.first_name || '';
          const last = order.customers?.last_name || '';
          const name = `${first} ${last}`.trim();
          return name || null;
        }
        case 'event_date':
          return order.event_date || null;
        case 'location': {
          const city = order.addresses?.city || '';
          const state = order.addresses?.state || '';
          const loc = `${city}, ${state}`.trim().replace(/^,\s*/, '');
          return loc || null;
        }
        case 'status':
          return order.status || null;
        case 'workflow':
          return order.workflow_status || 'pending';
        default:
          return null;
      }
    };

    filtered = [...filtered].sort((a: any, b: any) => {
      const aVal = getSortValue(a);
      const bVal = getSortValue(b);
      const aEmpty = aVal === null || aVal === undefined || (typeof aVal === 'string' && aVal.trim() === '');
      const bEmpty = bVal === null || bVal === undefined || (typeof bVal === 'string' && bVal.trim() === '');
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const result = (aVal as string).localeCompare(bVal as string, undefined, { sensitivity: 'base' });
      return direction === 'desc' ? -result : result;
    });
  } else if (activeTab === 'draft') {
    filtered = [...filtered].sort((a: any, b: any) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    );
  }

  return filtered;
}

function oracleTabCounts(categorizedOrders: any, ordersLength: number, showArchived: boolean) {
  const pastVisible = showArchived
    ? categorizedOrders.past.length
    : categorizedOrders.past.filter((o: any) => !o.archived_at).length;
  const cancelledVisible = showArchived
    ? categorizedOrders.cancelled.length
    : categorizedOrders.cancelled.filter((o: any) => !o.archived_at).length;
  return {
    draft: categorizedOrders.draft.length,
    pending_review: categorizedOrders.pending_review.length,
    awaiting_customer_approval: categorizedOrders.awaiting_customer_approval.length,
    current: categorizedOrders.current.length,
    upcoming: categorizedOrders.upcoming.length,
    past: pastVisible,
    cancelled: cancelledVisible,
    all: ordersLength,
    single_order: 0,
  };
}

function oracleDefaultTab(tabCounts: any): string {
  let tab: string;
  if (tabCounts.pending_review > 0) {
    tab = 'pending_review';
  } else if (tabCounts.awaiting_customer_approval > 0) {
    tab = 'awaiting_customer_approval';
  } else if (tabCounts.current > 0) {
    tab = 'current';
  } else if (tabCounts.upcoming > 0) {
    tab = 'upcoming';
  } else {
    tab = 'all';
  }
  return tab;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TABS: OrderTab[] = ['draft', 'pending_review', 'awaiting_customer_approval', 'current', 'upcoming', 'all', 'past', 'cancelled', 'single_order'];
const COLUMNS: Array<string | null> = [null, 'id', 'created_at', 'customer', 'event_date', 'location', 'status', 'workflow', 'bogus'];
const STATUSES = ['draft', 'pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void'];

let orderSeq = 0;
function mkOrder(over: any = {}): any {
  orderSeq++;
  return {
    id: `${String(orderSeq).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`, status: 'confirmed', event_date: '2026-07-04',
    created_at: '2026-06-01T10:00:00Z', archived_at: null, workflow_status: 'pending',
    customers: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.test', phone: '+1 555 0101' },
    addresses: { city: 'Tulsa', state: 'OK' },
    ...over,
  };
}

function compareAll(label: string, orders: any[], now: Date, contacts: Map<string, any>, combos: Array<{ tab: OrderTab; showArchived: boolean; search: string; col: string | null; dir: 'asc' | 'desc' }>) {
  const oc = oracleCategorize(orders, now);
  const nc = categorizeOrders(orders, now);
  compared++;
  ok(`${label}: categories`, same(nc, oc));
  ok(`${label}: categories.all is the input array`, nc.all === orders);
  for (const showArchived of [false, true]) {
    const oCounts = oracleTabCounts(oc, orders.length, showArchived);
    const nCounts = computeTabCounts(nc, orders.length, showArchived);
    compared++;
    ok(`${label}: tab counts (showArchived=${showArchived})`, same(nCounts, oCounts));
    ok(`${label}: default tab (showArchived=${showArchived})`, pickDefaultTab(nCounts) === oracleDefaultTab(oCounts));
  }
  for (const c of combos) {
    compared++;
    const o = oracleFilter(oc, c.tab, c.showArchived, c.search, c.col, c.dir, contacts);
    const n = filterAndSortOrders({ categorizedOrders: nc, activeTab: c.tab, showArchived: c.showArchived, searchTerm: c.search, sortColumn: c.col, sortDirection: c.dir, contactsMap: contacts });
    ok(`${label}: list tab=${c.tab} archived=${c.showArchived} search="${c.search}" col=${c.col} dir=${c.dir}`, same(n, o));
  }
  return { oc, nc };
}

const NOW = new Date(2026, 6, 4, 12, 0, 0); // local noon on 2026-07-04
const CONTACTS = new Map<string, any>([['ann@example.test', { business_name: ' Aardvark Events ' }], ['bo@example.test', { business_name: '   ' }], ['zz@example.test', { business_name: '  Zulu Rentals  ' }]]);

function runSuite(tzLabel: string) {
  orderSeq = 0;

  // ---- exhaustive small grid: every status x relevant dates ----
  {
    const dates = ['2026-07-03', '2026-07-04', '2026-07-05', '2026-12-31', '2027-01-01', '2026-07-04T00:00:00', '2026-07-04T23:59:59', '2026-07-04T12:00:00.000Z', '2026-06-30', '2026-08-01'];
    const orders: any[] = [];
    for (const status of STATUSES) for (const d of dates) orders.push(mkOrder({ status, event_date: d, archived_at: orders.length % 3 === 0 ? '2026-01-01' : null }));
    const combos: any[] = [];
    for (const tab of TABS) for (const showArchived of [false, true]) for (const col of COLUMNS) for (const dir of ['asc', 'desc'] as const) combos.push({ tab, showArchived, search: '', col, dir });
    compareAll(`[${tzLabel}] status x date grid`, orders, NOW, CONTACTS, combos);
  }

  // ---- search ----
  {
    const orders = [
      mkOrder({ status: 'confirmed', event_date: '2026-07-10', customers: { first_name: 'Ann', last_name: 'Lee', email: 'ANN@Example.test', phone: '+1 (918) 555-0101' } }),
      mkOrder({ status: 'confirmed', event_date: '2026-07-11', customers: { first_name: 'Bo', last_name: 'Ng', email: null, phone: null } }),
      mkOrder({ status: 'confirmed', event_date: '2026-07-12', customers: null }),
      mkOrder({ status: 'confirmed', event_date: '2026-07-13', customers: { first_name: undefined, last_name: undefined } }),
      mkOrder({ status: 'draft', event_date: '2026-08-01' }),
      mkOrder({ status: 'cancelled', event_date: '2026-05-01', archived_at: '2026-06-01' }),
    ];
    const terms = ['', 'ann', 'ANN', 'lee', 'ann lee', 'example.test', '918', '555-0101', '2026-07-1', '07-11', 'undefined', 'null undefined', orders[0].id.slice(0, 4), orders[0].id.slice(0, 4).toUpperCase(), 'zzz', ' ', 'bo ng'];
    const combos: any[] = [];
    for (const tab of TABS) for (const search of terms) for (const showArchived of [false, true]) combos.push({ tab, showArchived, search, col: null, dir: 'asc' });
    compareAll(`[${tzLabel}] search`, orders, NOW, CONTACTS, combos);
  }

  // ---- sorting: values, empties, business names, locations ----
  {
    const orders = [
      mkOrder({ id: 'bbbbbbbb-0000-0000-0000-000000000001', event_date: '2026-07-20', created_at: '2026-06-02', customers: { first_name: 'zed', last_name: 'z', email: 'ann@example.test' }, addresses: { city: 'Tulsa', state: 'OK' }, workflow_status: 'on_the_way', status: 'confirmed' }),
      mkOrder({ id: 'aaaaaaaa-0000-0000-0000-000000000002', event_date: '2026-07-19', created_at: null, customers: { first_name: 'Amy', last_name: 'B', email: 'bo@example.test' }, addresses: { city: '', state: 'OK' }, workflow_status: null, status: 'in_progress' }),
      mkOrder({ id: 'cccccccc-0000-0000-0000-000000000003', event_date: '', created_at: '2026-06-03', customers: { first_name: '', last_name: '', email: 'x@example.test' }, addresses: null, workflow_status: undefined, status: 'completed' }),
      mkOrder({ id: 'dddddddd-0000-0000-0000-000000000004', event_date: '2026-07-21', created_at: '', customers: null, addresses: { city: 'Aurora', state: '' }, workflow_status: 'arrived', status: '' }),
      mkOrder({ id: 'eeeeeeee-0000-0000-0000-000000000005', event_date: '2026-07-22', created_at: '2026-06-01', customers: { first_name: 'ann', last_name: 'LEE' }, addresses: { city: 'tulsa', state: 'ok' } }),
      mkOrder({ id: 'ffffffff-0000-0000-0000-000000000006', event_date: '2026-07-23', customers: { first_name: 'Ann', last_name: 'Lee' }, addresses: { city: ' ', state: ' ' } }),
    ];
    const combos: any[] = [];
    for (const tab of ['all', 'current', 'upcoming', 'past'] as OrderTab[]) for (const col of COLUMNS) for (const dir of ['asc', 'desc'] as const) combos.push({ tab, showArchived: true, search: '', col, dir });
    compareAll(`[${tzLabel}] sort`, orders, NOW, CONTACTS, combos);
  }

  // ---- sorting with many empty values and ties (comparator consistency) ----
  {
    const orders: any[] = [];
    for (let k = 0; k < 14; k++) orders.push(mkOrder({ id: `aaaaaaaa-${String(14 - k).padStart(4, '0')}-0000-0000-000000000000`, created_at: k % 4 === 0 ? `2026-06-${10 + k}` : (k % 2 ? null : ''), customers: k % 3 === 0 ? { first_name: 'Cy', last_name: 'D', email: 'ann@example.test' } : null, event_date: `2026-08-${10 + (k % 5)}` }));
    orders.push(mkOrder({ customers: { first_name: 'Al', last_name: 'Q', email: 'zz@example.test' } }));
    const combos: any[] = [];
    for (const col of ['id', 'created_at', 'customer', 'event_date', 'location', 'workflow']) for (const dir of ['asc', 'desc'] as const) combos.push({ tab: 'all', showArchived: true, search: '', col, dir });
    compareAll(`[${tzLabel}] sort with many empties and ties`, orders, NOW, CONTACTS, combos);
    const byId = filterAndSortOrders({ categorizedOrders: categorizeOrders(orders, NOW), activeTab: 'all', showArchived: true, searchTerm: '', sortColumn: 'id', sortDirection: 'asc', contactsMap: CONTACTS });
    eq(`[${tzLabel}] id sort compares the formatted order id (ties keep input order)`, byId.map((o: any) => o.id).filter((id: string) => id.startsWith('aaaaaaaa')), orders.map((o: any) => o.id).filter((id: string) => id.startsWith('aaaaaaaa')));
    const byCustomer = filterAndSortOrders({ categorizedOrders: categorizeOrders(orders, NOW), activeTab: 'all', showArchived: true, searchTerm: '', sortColumn: 'customer', sortDirection: 'asc', contactsMap: CONTACTS });
    ok(`[${tzLabel}] customer sort uses the trimmed business name before the person name`, byCustomer[0].customers?.email === 'ann@example.test');
    const empties = filterAndSortOrders({ categorizedOrders: categorizeOrders(orders, NOW), activeTab: 'all', showArchived: true, searchTerm: '', sortColumn: 'created_at', sortDirection: 'asc', contactsMap: CONTACTS });
    eq(`[${tzLabel}] empty values sort last and keep their relative order`, empties.slice(-10).map((o: any) => o.id), orders.filter((o: any) => !o.created_at).map((o: any) => o.id));
  }

  // ---- large seeded sort grids with many empty values (inconsistent-comparator sensitivity) ----
  {
    let seed = 777;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    for (let round = 0; round < 6; round++) {
      const n = pick([12, 25, 40, 60]);
      const orders = Array.from({ length: n }, () => mkOrder({
        created_at: pick([null, '', '2026-06-01', '2026-06-02', '2026-05-30']), event_date: pick(['2026-08-01', '2026-08-02', '', '2026-07-30']),
        customers: pick([null, { first_name: '', last_name: '' }, { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.test' }, { first_name: 'Bo', last_name: 'Ng', email: 'zz@example.test' }, { first_name: 'Cy', last_name: 'Dee' }]),
        addresses: pick([null, { city: '', state: '' }, { city: 'Tulsa', state: 'OK' }, { city: 'Aurora', state: 'CO' }]), workflow_status: pick([null, 'arrived', 'pending', 'on_the_way']),
      }));
      const combos: any[] = [];
      for (const col of ['created_at', 'customer', 'event_date', 'location', 'workflow', 'status']) for (const dir of ['asc', 'desc'] as const) combos.push({ tab: 'all', showArchived: true, search: '', col, dir });
      compareAll(`[${tzLabel}] large sort grid ${round}`, orders, NOW, CONTACTS, combos);
    }
  }

  // ---- draft default sort and cancelled sort ----
  {
    const orders = [
      mkOrder({ status: 'draft', created_at: '2026-06-01' }), mkOrder({ status: 'draft', created_at: '2026-06-03' }), mkOrder({ status: 'draft', created_at: null }), mkOrder({ status: 'draft', created_at: '2026-06-02' }),
      mkOrder({ status: 'cancelled', event_date: '2026-03-01' }), mkOrder({ status: 'cancelled', event_date: '2026-05-01', archived_at: '2026-06-01' }), mkOrder({ status: 'cancelled', event_date: '2026-04-01' }), mkOrder({ status: 'cancelled', event_date: '2026-04-01T00:00:00' }),
    ];
    const combos: any[] = [];
    for (const tab of ['draft', 'cancelled'] as OrderTab[]) for (const showArchived of [false, true]) for (const col of [null, 'created_at', 'event_date']) for (const dir of ['asc', 'desc'] as const) combos.push({ tab, showArchived, search: '', col, dir });
    const { nc } = compareAll(`[${tzLabel}] draft and cancelled ordering`, orders, NOW, CONTACTS, combos);
    // (An event_date that already has a time part becomes an Invalid Date under the cancelled sort's noon parse, so
    // its position is unspecified; it is excluded from this hand pin and still covered by the differential check.)
    eq(`[${tzLabel}] cancelled bucket is sorted newest event first`, nc.cancelled.map((o: any) => o.event_date).filter((d: string) => !d.includes('T')), ['2026-05-01', '2026-04-01', '2026-03-01']);
    const draftList = filterAndSortOrders({ categorizedOrders: nc, activeTab: 'draft', showArchived: false, searchTerm: '', sortColumn: null, sortDirection: 'asc', contactsMap: CONTACTS });
    eq(`[${tzLabel}] draft default sort is created_at descending with empty last`, draftList.map((o: any) => o.created_at), ['2026-06-03', '2026-06-02', '2026-06-01', null]);
  }

  // ---- default-tab priority and counts across contrived mixes ----
  {
    const mixes: Array<[string, any[]]> = [
      ['empty', []],
      ['only draft', [mkOrder({ status: 'draft' })]],
      ['only past', [mkOrder({ event_date: '2026-01-01' })]],
      ['only upcoming', [mkOrder({ event_date: '2026-09-01' })]],
      ['upcoming and current', [mkOrder({ event_date: '2026-09-01' }), mkOrder({ event_date: '2026-07-04' })]],
      ['current only (local noon today)', [mkOrder({ event_date: '2026-07-04T12:00:00' })]],
      ['awaiting beats current', [mkOrder({ status: 'awaiting_customer_approval' }), mkOrder({ event_date: '2026-07-04T12:00:00' })]],
      ['pending beats awaiting', [mkOrder({ status: 'pending_review' }), mkOrder({ status: 'awaiting_customer_approval' })]],
      ['archived past only', [mkOrder({ event_date: '2026-01-01', archived_at: '2026-02-01' })]],
      ['cancelled only', [mkOrder({ status: 'cancelled', event_date: '2026-09-01' })]],
    ];
    for (const [name, orders] of mixes) {
      const combos: any[] = TABS.map((tab) => ({ tab, showArchived: false, search: '', col: null, dir: 'asc' }));
      compareAll(`[${tzLabel}] mix: ${name}`, orders, NOW, CONTACTS, combos);
    }
    const pending = categorizeOrders([mkOrder({ status: 'pending_review' }), mkOrder({ status: 'awaiting_customer_approval' })], NOW);
    eq(`[${tzLabel}] default tab: pending review wins`, pickDefaultTab(computeTabCounts(pending, 2, false)), 'pending_review');
    eq(`[${tzLabel}] default tab: nothing -> all`, pickDefaultTab(computeTabCounts(categorizeOrders([], NOW), 0, false)), 'all');
    eq(`[${tzLabel}] default tab never picks draft, past or cancelled`, pickDefaultTab(computeTabCounts(categorizeOrders([mkOrder({ status: 'draft' }), mkOrder({ event_date: '2020-01-01' }), mkOrder({ status: 'cancelled' })], NOW), 3, true)), 'all');
  }

  // ---- time boundaries around local midnight (same-process differential) ----
  {
    const nows = [new Date(2026, 6, 4, 0, 0, 0), new Date(2026, 6, 4, 23, 59, 59), new Date(2026, 6, 4, 12, 0, 0), new Date(2026, 11, 31, 23, 30), new Date(2027, 0, 1, 0, 0, 1), new Date(2026, 1, 28, 12), new Date(Date.UTC(2026, 6, 4, 0, 0, 0)), new Date(Date.UTC(2026, 6, 4, 23, 59, 59))];
    const dates = ['2026-07-03', '2026-07-04', '2026-07-05', '2026-12-31', '2027-01-01', '2026-02-28', '2026-03-01', '2026-07-04T00:00:00', '2026-07-04T00:00:00Z', '2026-07-04T23:59:59Z'];
    const orders = dates.map((d) => mkOrder({ event_date: d }));
    nows.forEach((now, i) => compareAll(`[${tzLabel}] boundary now#${i}`, orders, now, CONTACTS, [{ tab: 'current', showArchived: false, search: '', col: null, dir: 'asc' }, { tab: 'past', showArchived: true, search: '2026', col: 'event_date', dir: 'desc' }]));
  }
}

// ---------------------------------------------------------------------------
// Run under several time zones (when the runtime honours a TZ change) and pin the known quirk by hand
// ---------------------------------------------------------------------------
const realTz = process.env.TZ;
const offsetProbe = () => new Date(2026, 6, 4).getTimezoneOffset();
const tzResults: Record<string, number> = {};
for (const tz of ['UTC', 'America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland']) {
  process.env.TZ = tz;
  tzResults[tz] = offsetProbe();
  runSuite(tz);
}
const honoursTz = tzResults['UTC'] === 0 && tzResults['America/Chicago'] === 300 && tzResults['Asia/Tokyo'] === -540;
console.log('TZ switching effective:', honoursTz, JSON.stringify(tzResults));

if (honoursTz) {
  const dayOf = (tz: string, orderDate: string) => {
    process.env.TZ = tz;
    const o = { id: 'zzzzzzzz-0000-0000-0000-000000000000', status: 'confirmed', event_date: orderDate };
    const nc = categorizeOrders([o], new Date(2026, 6, 4, 12, 0, 0));
    return nc.current.length ? 'current' : nc.upcoming.length ? 'upcoming' : 'past';
  };
  eq('KNOWN QUIRK: UTC machine puts a date-only event today in Current', dayOf('UTC', '2026-07-04'), 'current');
  eq('KNOWN QUIRK: US Central puts a date-only event today in Past (UTC midnight is the previous local evening)', dayOf('America/Chicago', '2026-07-04'), 'past');
  eq('KNOWN QUIRK: Tokyo puts a date-only event today in Current', dayOf('Asia/Tokyo', '2026-07-04'), 'current');
  eq('KNOWN QUIRK: US Central tomorrow date-only is Current, not Upcoming', dayOf('America/Chicago', '2026-07-05'), 'current');
  process.env.TZ = 'America/Chicago';
  const search = filterAndSortOrders({ categorizedOrders: categorizeOrders([{ id: 'yyyyyyyy-0000-0000-0000-000000000000', status: 'confirmed', event_date: '2026-07-04', customers: null }], new Date(2026, 6, 4, 12)), activeTab: 'all', showArchived: false, searchTerm: '2026-07-03', sortColumn: null, sortDirection: 'asc', contactsMap: new Map() });
  eq('KNOWN QUIRK: US Central search text shows the PREVIOUS day for a date-only event', search.length, 1);
  const cancelledSortProbe = (() => {
    const list = [{ id: 'a', status: 'cancelled', event_date: '2026-07-04' }, { id: 'b', status: 'cancelled', event_date: '2026-07-05' }];
    return categorizeOrders(list, new Date(2026, 6, 4)).cancelled.map((o: any) => o.id);
  })();
  eq('cancelled bucket sort uses local noon parsing (newest first)', cancelledSortProbe, ['b', 'a']);
}
if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;

// ---- tab count / archive pins independent of dates ----
{
  const orders = [mkOrder({ event_date: '2020-01-01', archived_at: '2021-01-01' }), mkOrder({ event_date: '2020-01-02' }), mkOrder({ status: 'cancelled', archived_at: '2021-01-01' }), mkOrder({ status: 'cancelled' })];
  const cats = categorizeOrders(orders, NOW);
  eq('archived orders are hidden from the past and cancelled badge counts unless shown', [computeTabCounts(cats, 4, false).past, computeTabCounts(cats, 4, false).cancelled, computeTabCounts(cats, 4, true).past, computeTabCounts(cats, 4, true).cancelled], [1, 1, 2, 2]);
  eq('all count is the order count and single_order is zero', [computeTabCounts(cats, 4, false).all, computeTabCounts(cats, 4, false).single_order], [4, 0]);
  const hidden = filterAndSortOrders({ categorizedOrders: cats, activeTab: 'past', showArchived: false, searchTerm: '', sortColumn: null, sortDirection: 'asc', contactsMap: new Map() });
  const shown = filterAndSortOrders({ categorizedOrders: cats, activeTab: 'past', showArchived: true, searchTerm: '', sortColumn: null, sortDirection: 'asc', contactsMap: new Map() });
  eq('archived filter applies only to past and cancelled', [hidden.length, shown.length], [1, 2]);
  const allTab = filterAndSortOrders({ categorizedOrders: cats, activeTab: 'all', showArchived: false, searchTerm: '', sortColumn: null, sortDirection: 'asc', contactsMap: new Map() });
  eq('the All tab ignores archive visibility', allTab.length, 4);
  eq('an unknown tab yields an empty list', filterAndSortOrders({ categorizedOrders: cats, activeTab: 'single_order', showArchived: false, searchTerm: '', sortColumn: null, sortDirection: 'asc', contactsMap: new Map() }), []);
}

console.log(`Orders list model differential tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
if (failed > 0) throw new Error(`${failed} orders list model test(s) failed`);
