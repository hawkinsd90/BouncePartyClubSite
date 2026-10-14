// Pure order-list model, extracted verbatim from OrdersManager.
//
// Categorization into tabs, archive visibility, search, sorting, tab counts and the default-tab choice. The
// component keeps all React state, URL sync, realtime, the archive RPC and scroll tracking, and calls these
// functions from its memos and effect.
//
// Preserved quirks (do not "fix" here): event_date is parsed with `new Date(order.event_date)` (a date-only
// string is read as UTC midnight) and compared against LOCAL midnight bounds, so in negative-UTC-offset
// time zones today's orders can land in Past; the search text formats the same parsed date; the cancelled
// sort uses a different parse (`event_date + 'T12:00:00'`, local noon). The component's filteredOrders memo
// still omits showArchived from its dependency list; that is a component concern and is left unchanged.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { format } from 'date-fns';
import { formatOrderId } from '../utils';
import { ORDER_STATUS } from '../constants/statuses';

export type OrderTab = 'draft' | 'pending_review' | 'awaiting_customer_approval' | 'current' | 'upcoming' | 'all' | 'past' | 'cancelled' | 'single_order';

export interface OrderCategories {
  draft: any[];
  pending_review: any[];
  awaiting_customer_approval: any[];
  current: any[];
  upcoming: any[];
  past: any[];
  cancelled: any[];
  all: any[];
}

export type OrderTabCounts = Record<OrderTab, number>;

// `now` is injected (the component passes `new Date()` when the memo runs).
export function categorizeOrders(orders: any[], now: Date): OrderCategories {
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

    // Add to status-specific categories
    if (order.status === ORDER_STATUS.DRAFT) {
      categories.draft.push(order);
    } else if (order.status === ORDER_STATUS.PENDING) {
      categories.pending_review.push(order);
    } else if (order.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL) {
      categories.awaiting_customer_approval.push(order);
    } else if (order.status === ORDER_STATUS.CANCELLED) {
      categories.cancelled.push(order);
    }

    // Add to time-based categories (exclude certain statuses)
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

export interface FilterAndSortInput {
  categorizedOrders: OrderCategories;
  activeTab: OrderTab;
  showArchived: boolean;
  searchTerm: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  contactsMap: Map<string, any>;
}

export function filterAndSortOrders({
  categorizedOrders, activeTab, showArchived, searchTerm, sortColumn, sortDirection, contactsMap,
}: FilterAndSortInput): any[] {
  let filtered = categorizedOrders[activeTab as keyof typeof categorizedOrders] || [];

  if ((activeTab === 'past' || activeTab === 'cancelled') && !showArchived) {
    filtered = filtered.filter((o: any) => !o.archived_at);
  }

  const search = searchTerm.toLowerCase();
  if (search) {
    filtered = filtered.filter(order => {
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

  // Apply sorting
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

    filtered = [...filtered].sort((a, b) => {
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
    filtered = [...filtered].sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    );
  }

  return filtered;
}

// Tab badge counts — past and cancelled respect the showArchived flag so the badge count always matches
// what is actually visible in the list.
export function computeTabCounts(categorizedOrders: OrderCategories, ordersLength: number, showArchived: boolean): OrderTabCounts {
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

// Default tab when the URL names none: the first tab with something in it, in this priority order.
export function pickDefaultTab(tabCounts: OrderTabCounts): OrderTab {
  if (tabCounts.pending_review > 0) {
    return 'pending_review';
  } else if (tabCounts.awaiting_customer_approval > 0) {
    return 'awaiting_customer_approval';
  } else if (tabCounts.current > 0) {
    return 'current';
  } else if (tabCounts.upcoming > 0) {
    return 'upcoming';
  } else {
    return 'all';
  }
}
