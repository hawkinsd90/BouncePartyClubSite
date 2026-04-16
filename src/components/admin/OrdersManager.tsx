import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Search, Calendar, User, Phone, Archive, ArchiveX, ArchiveRestore } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';
import { OrderDetailModal } from '../admin/OrderDetailModal';
import { PendingOrderCard } from '../admin/PendingOrderCard';
import { SingleOrderView } from '../admin/SingleOrderView';
import { AdminFloatingOrderHeader } from '../admin/AdminFloatingOrderHeader';
import { useDataFetch } from '../../hooks/useDataFetch';
import { handleError } from '../../lib/errorHandling';
import { formatOrderId } from '../../lib/utils';
import { getAllOrdersWithContacts } from '../../lib/queries/orders';
import { showConfirm } from '../common/CustomModal';
import { ORDER_STATUS } from '../../lib/constants/statuses';
import { OrderStatusBadge } from '../dashboard/OrderStatusBadge';


type OrderTab = 'draft' | 'pending_review' | 'awaiting_customer_approval' | 'current' | 'upcoming' | 'all' | 'past' | 'cancelled' | 'single_order';

interface OrdersData {
  orders: any[];
  contactsMap: Map<string, any>;
}

export function OrdersManager() {
  const [searchParams, setSearchParams] = useSearchParams();
  const orderIdFromUrl = searchParams.get('order');
  const tabFromUrl = searchParams.get('subtab') as OrderTab | null;
  const singleOrderId = searchParams.get('orderId');
  const editMode = searchParams.get('edit') === 'true';
  const [activeTab, setActiveTab] = useState<OrderTab>(tabFromUrl || 'draft');
  const [searchTerm, setSearchTerm] = useState('');
  const [singleOrderSearchId, setSingleOrderSearchId] = useState(singleOrderId || '');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [visibleOrder, setVisibleOrder] = useState<any>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const orderCardsRef = useRef<Map<string, { card: HTMLElement, actionButtons: HTMLElement | null }>>(new Map());
  const isRefetchingRef = useRef(false);
  const pendingRefetchRef = useRef(false);

  const fetchOrdersData = useCallback(async () => {
    // Load up to 200 most recent orders by default for performance
    const { data, error } = await getAllOrdersWithContacts(200);

    if (error) throw error;

    return data || { orders: [], contactsMap: new Map() };
  }, []);

  const handleOrdersError = useCallback((error: any) => {
    handleError(error, 'OrdersManager.loadOrders');
  }, []);

  const { data, loading, refetch } = useDataFetch<OrdersData>(
    fetchOrdersData,
    {
      errorMessage: 'Failed to load orders',
      onError: handleOrdersError,
    }
  );

  const orders = data?.orders || [];
  const contactsMap = data?.contactsMap || new Map();

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (isRefetchingRef.current) {
          pendingRefetchRef.current = true;
          return;
        }
        isRefetchingRef.current = true;
        pendingRefetchRef.current = false;
        try {
          await refetch();
        } finally {
          isRefetchingRef.current = false;
          if (pendingRefetchRef.current) {
            pendingRefetchRef.current = false;
            debouncedRefetch();
          }
        }
      }, 800);
    };

    const channel = supabase
      .channel('orders-manager-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        debouncedRefetch
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        debouncedRefetch
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  async function handleArchiveOldOrders() {
    const confirmed = await showConfirm(
      'Archive completed and cancelled orders older than 90 days?\n\nThey will be hidden from the Past and Cancelled tabs by default but can be shown with "Show Archived".',
      'Archive Old Orders'
    );
    if (!confirmed) return;
    setArchiving(true);
    try {
      const { error } = await supabase.rpc('archive_old_orders', { threshold_days: 90 });
      if (error) throw error;
      showToast('Old orders archived successfully.', 'success');
      refetch();
    } catch (err: any) {
      showToast('Failed to archive orders: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setArchiving(false);
    }
  }

  // Categorize orders once for performance
  const categorizedOrders = useMemo(() => {
    const now = new Date();
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

    return categories;
  }, [orders]);

  const filteredOrders = useMemo(() => {
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

    return filtered;
  }, [categorizedOrders, activeTab, searchTerm]);

  // Memoize tab counts — past and cancelled respect the showArchived flag
  // so the badge count always matches what is actually visible in the list.
  const tabCounts = useMemo(() => {
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
      all: orders.length,
      single_order: 0,
    };
  }, [categorizedOrders, orders.length, showArchived]);

  useEffect(() => {
    if (!tabFromUrl && !singleOrderId) {
      // Determine default tab based on counts
      if (tabCounts.pending_review > 0) {
        setActiveTab('pending_review');
      } else if (tabCounts.awaiting_customer_approval > 0) {
        setActiveTab('awaiting_customer_approval');
      } else if (tabCounts.current > 0) {
        setActiveTab('current');
      } else if (tabCounts.upcoming > 0) {
        setActiveTab('upcoming');
      } else {
        setActiveTab('all');
      }
    }
  }, [orders.length, tabFromUrl, singleOrderId]);

  useEffect(() => {
    if (tabFromUrl) {
      setActiveTab(tabFromUrl);
    }
    if (singleOrderId) {
      setSingleOrderSearchId(singleOrderId);
      setActiveTab('single_order');
    }
  }, [tabFromUrl, singleOrderId]);

  useEffect(() => {
    if (orderIdFromUrl && orders.length > 0 && !selectedOrder) {
      const order = orders.find(o => o.id === orderIdFromUrl);
      if (order) {
        setSelectedOrder(order);
        const params = new URLSearchParams(searchParams);
        params.delete('order');
        setSearchParams(params);
      }
    }
  }, [orderIdFromUrl, orders, selectedOrder]);

  function getTabCount(tab: OrderTab): number {
    return tabCounts[tab] || 0;
  }

  const tabs: { key: OrderTab; label: string }[] = [
    { key: 'single_order', label: 'Single Order' },
    { key: 'draft', label: 'Draft (Needs Deposit)' },
    { key: 'pending_review', label: 'Pending Review' },
    { key: 'awaiting_customer_approval', label: 'Awaiting Customer Approval' },
    { key: 'current', label: 'Current (Today)' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'all', label: 'All Orders' },
    { key: 'past', label: 'Past' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  const handleTabChange = useCallback((tab: OrderTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams);
    params.set('subtab', tab);
    if (tab !== 'single_order') {
      params.delete('orderId');
      params.delete('edit');
      setSingleOrderSearchId('');
    }
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleSingleOrderSearch = useCallback(() => {
    if (singleOrderSearchId.trim()) {
      const params = new URLSearchParams(searchParams);
      params.set('subtab', 'single_order');
      params.set('orderId', singleOrderSearchId.trim());
      setSearchParams(params);
    }
  }, [singleOrderSearchId, searchParams, setSearchParams]);

  useEffect(() => {
    if (activeTab !== 'pending_review' && activeTab !== 'awaiting_customer_approval') {
      setVisibleOrder(null);
      return;
    }

    let rafId: number | null = null;

    function computeVisibleOrder() {
      let bestMatch = null;
      let closestDistance = Infinity;

      orderCardsRef.current.forEach((refs, orderId) => {
        const { card, actionButtons } = refs;
        const cardRect = card.getBoundingClientRect();

        const triggerElement = actionButtons || card;
        const triggerRect = triggerElement.getBoundingClientRect();

        const hasScrolledPastTop = cardRect.top < 64;
        const actionButtonsVisible = triggerRect.bottom > 64;

        if (hasScrolledPastTop && actionButtonsVisible) {
          const distanceFromTop = Math.abs(cardRect.top - 64);

          if (distanceFromTop < closestDistance) {
            closestDistance = distanceFromTop;
            const order = filteredOrders.find(o => o.id === orderId);
            if (order) {
              bestMatch = order;
            }
          }
        }
      });

      setVisibleOrder(bestMatch);
    }

    function handleScroll() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeVisibleOrder();
      });
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    computeVisibleOrder();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeTab, filteredOrders]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-slate-600">Loading orders...</p>
      </div>
    );
  }

  const showFloatingHeader = !!visibleOrder && (activeTab === 'pending_review' || activeTab === 'awaiting_customer_approval');

  const handleEditFromFloatingHeader = () => {
    if (visibleOrder) {
      setSelectedOrder(visibleOrder);
    }
  };

  return (
    <div className={showFloatingHeader ? 'pt-20' : ''}>
      <AdminFloatingOrderHeader
        order={visibleOrder}
        isVisible={showFloatingHeader}
        onEditClick={handleEditFromFloatingHeader}
      />

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, email, phone, date, or order ID..."
            className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors relative ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-600'
            }`}
          >
            {tab.label}
            {getTabCount(tab.key) > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${
                activeTab === tab.key
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}>
                {getTabCount(tab.key)}
              </span>
            )}
          </button>
        ))}
      </div>

      {(activeTab === 'past' || activeTab === 'cancelled') && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-600">
            {showArchived
              ? 'Showing all orders including archived'
              : 'Archived orders hidden — use "Show Archived" to reveal them'}
          </p>
          <div className="flex items-center gap-2">
            {activeTab === 'past' && (
              <button
                onClick={handleArchiveOldOrders}
                disabled={archiving}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors bg-white text-slate-700 border-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                <ArchiveRestore className="w-4 h-4" />
                {archiving ? 'Archiving...' : 'Archive Old Orders'}
              </button>
            )}
            <button
              onClick={() => setShowArchived(v => !v)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                showArchived
                  ? 'bg-slate-700 text-white border-slate-700 hover:bg-slate-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'
              }`}
            >
              {showArchived ? <ArchiveX className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
              {showArchived ? 'Hide Archived' : 'Show Archived'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'single_order' ? (
        singleOrderId ? (
          <SingleOrderView
            orderId={singleOrderId}
            openEditMode={editMode}
            onBack={() => handleTabChange('all')}
            onUpdate={refetch}
          />
        ) : (
          <div className="bg-white rounded-lg shadow p-8">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Search for an Order</h3>
            <p className="text-slate-600 mb-6">Enter an order ID to view a specific order</p>
            <div className="flex gap-3 max-w-xl">
              <input
                type="text"
                value={singleOrderSearchId}
                onChange={(e) => setSingleOrderSearchId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSingleOrderSearch()}
                placeholder="Enter Order ID (e.g., CDF04DF2)"
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSingleOrderSearch}
                disabled={!singleOrderSearchId.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                Search
              </button>
            </div>
          </div>
        )
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-slate-600 text-lg">No orders found</p>
          <p className="text-slate-500 text-sm mt-2">
            {searchTerm ? 'Try adjusting your search' : 'Orders will appear here when created'}
          </p>
        </div>
      ) : activeTab === 'pending_review' || activeTab === 'awaiting_customer_approval' ? (
        <div className="space-y-4">
          {filteredOrders.map(order => (
            <PendingOrderCard
              key={order.id}
              order={order}
              onUpdate={refetch}
              ref={(refs: { card: HTMLElement, actionButtons: HTMLElement | null } | null) => {
                if (refs) {
                  orderCardsRef.current.set(order.id, refs);
                } else {
                  orderCardsRef.current.delete(order.id);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Order ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Event Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Location</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Workflow</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {filteredOrders.map(order => (
                <tr
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-mono font-semibold text-blue-600">
                      {formatOrderId(order.id).toUpperCase()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-900">
                      {format(new Date(order.created_at), 'MMM d, yyyy')}
                    </div>
                    <div className="text-xs text-slate-500">
                      {format(new Date(order.created_at), 'h:mm a')}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <User className="w-4 h-4 mr-2 text-slate-400" />
                      <div>
                        {contactsMap.get(order.customers?.email)?.business_name && (
                          <div className="text-sm font-bold text-slate-900">
                            {contactsMap.get(order.customers?.email)?.business_name}
                          </div>
                        )}
                        <div className="text-sm font-medium text-slate-900">
                          {order.customers?.first_name} {order.customers?.last_name}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
                          <Phone className="w-3 h-3" />
                          {order.customers?.phone}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <Calendar className="w-4 h-4 mr-2 text-slate-400" />
                      <div>
                        <div className="text-sm text-slate-900">
                          {format(new Date(order.event_date + 'T12:00:00'), 'MMM d, yyyy')}
                        </div>
                        <div className="text-xs text-slate-500">
                          {order.start_window} - {order.end_window}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-900">
                      {order.addresses?.city}, {order.addresses?.state}
                    </div>
                    <div className="text-xs text-slate-500 capitalize">
                      {order.location_type}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <OrderStatusBadge order={order} />
                      {order.archived_at && (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-500">
                          <Archive className="w-3 h-3" />
                          Archived
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      order.workflow_status === 'completed' ? 'bg-green-100 text-green-800' :
                      order.workflow_status === 'setup_completed' ? 'bg-blue-100 text-blue-800' :
                      order.workflow_status === 'on_the_way' ? 'bg-cyan-100 text-cyan-800' :
                      'bg-slate-100 text-slate-800'
                    }`}>
                      {order.workflow_status?.replace(/_/g, ' ') || 'pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdate={refetch}
        />
      )}
    </div>
  );
}
