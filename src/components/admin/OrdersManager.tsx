import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { format, isToday, isFuture, isPast } from 'date-fns';
import { Search, Calendar, User, Phone } from 'lucide-react';
import { OrderDetailModal } from '../admin/OrderDetailModal';
import { PendingOrderCard } from '../admin/PendingOrderCard';
import { useDataFetch } from '../../hooks/useDataFetch';
import { handleError } from '../../lib/errorHandling';
import { ORDER_STATUS } from '../../lib/constants/statuses';


type OrderTab = 'draft' | 'pending_review' | 'awaiting_customer_approval' | 'current' | 'upcoming' | 'all' | 'past' | 'cancelled';

interface OrdersData {
  orders: any[];
  contactsMap: Map<string, any>;
}

export function OrdersManager() {
  const [searchParams, setSearchParams] = useSearchParams();
  const orderIdFromUrl = searchParams.get('order');
  const [activeTab, setActiveTab] = useState<OrderTab>('draft');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  const fetchOrdersData = useCallback(async () => {
    const { data: ordersData, error } = await supabase
      .from('orders')
      .select(`
        *,
        customers (first_name, last_name, email, phone),
        addresses (line1, line2, city, state, zip)
      `)
      .order('event_date', { ascending: true });

    if (error) throw error;

    const { data: contacts } = await supabase
      .from('contacts')
      .select('email, business_name');

    const contactsMap = new Map();
    contacts?.forEach(c => contactsMap.set(c.email, c));

    return {
      orders: ordersData || [],
      contactsMap,
    };
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
    determineDefaultTab();
  }, [orders]);

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

  function determineDefaultTab() {
    const pendingReview = orders.filter(o => o.status === ORDER_STATUS.PENDING).length;
    const awaitingApproval = orders.filter(o => o.status === ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL).length;
    const current = orders.filter(o => isToday(new Date(o.event_date)) && o.status !== ORDER_STATUS.CANCELLED && o.status !== ORDER_STATUS.PENDING && o.status !== ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL && o.status !== ORDER_STATUS.DRAFT).length;
    const upcoming = orders.filter(o => isFuture(new Date(o.event_date)) && o.status !== ORDER_STATUS.CANCELLED && o.status !== ORDER_STATUS.PENDING && o.status !== ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL && o.status !== ORDER_STATUS.DRAFT).length;

    if (pendingReview > 0) {
      setActiveTab('pending_review');
    } else if (awaitingApproval > 0) {
      setActiveTab('awaiting_customer_approval');
    } else if (current > 0) {
      setActiveTab('current');
    } else if (upcoming > 0) {
      setActiveTab('upcoming');
    } else {
      setActiveTab('all');
    }
  }

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];

    const search = searchTerm.toLowerCase();
    if (search) {
      filtered = filtered.filter(order => {
        const customerName = `${order.customers?.first_name} ${order.customers?.last_name}`.toLowerCase();
        const email = order.customers?.email?.toLowerCase() || '';
        const phone = order.customers?.phone?.toLowerCase() || '';
        const eventDate = format(new Date(order.event_date), 'yyyy-MM-dd');
        const orderId = order.id.slice(0, 8).toLowerCase();

        return customerName.includes(search) ||
               email.includes(search) ||
               phone.includes(search) ||
               eventDate.includes(search) ||
               orderId.includes(search);
      });
    }

    switch (activeTab) {
      case 'draft':
        filtered = filtered.filter(o => o.status === 'draft');
        break;
      case 'pending_review':
        filtered = filtered.filter(o => o.status === 'pending_review');
        break;
      case 'awaiting_customer_approval':
        filtered = filtered.filter(o => o.status === 'awaiting_customer_approval');
        break;
      case 'current':
        filtered = filtered.filter(o => {
          const eventDate = new Date(o.event_date);
          return isToday(eventDate) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'awaiting_customer_approval' && o.status !== 'draft';
        });
        break;
      case 'upcoming':
        filtered = filtered.filter(o => {
          const eventDate = new Date(o.event_date);
          return isFuture(eventDate) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'awaiting_customer_approval' && o.status !== 'draft';
        });
        break;
      case 'past':
        filtered = filtered.filter(o => {
          const eventDate = new Date(o.event_date);
          return isPast(eventDate) && !isToday(eventDate) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft';
        });
        break;
      case 'cancelled':
        filtered = filtered.filter(o => o.status === 'cancelled');
        break;
    }

    return filtered;
  }, [orders, activeTab, searchTerm]);

  function getTabCount(tab: OrderTab): number {
    switch (tab) {
      case 'draft':
        return orders.filter(o => o.status === 'draft').length;
      case 'pending_review':
        return orders.filter(o => o.status === 'pending_review').length;
      case 'awaiting_customer_approval':
        return orders.filter(o => o.status === 'awaiting_customer_approval').length;
      case 'current':
        return orders.filter(o => isToday(new Date(o.event_date)) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'awaiting_customer_approval' && o.status !== 'draft').length;
      case 'upcoming':
        return orders.filter(o => isFuture(new Date(o.event_date)) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'awaiting_customer_approval' && o.status !== 'draft').length;
      case 'past':
        return orders.filter(o => {
          const eventDate = new Date(o.event_date);
          return isPast(eventDate) && !isToday(eventDate) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'awaiting_customer_approval' && o.status !== 'draft';
        }).length;
      case 'cancelled':
        return orders.filter(o => o.status === 'cancelled').length;
      case 'all':
        return orders.length;
      default:
        return 0;
    }
  }

  const tabs: { key: OrderTab; label: string }[] = [
    { key: 'draft', label: 'Draft (Needs Deposit)' },
    { key: 'pending_review', label: 'Pending Review' },
    { key: 'awaiting_customer_approval', label: 'Awaiting Customer Approval' },
    { key: 'current', label: 'Current (Today)' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'all', label: 'All Orders' },
    { key: 'past', label: 'Past' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-slate-600">Loading orders...</p>
      </div>
    );
  }

  return (
    <div>
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
            onClick={() => setActiveTab(tab.key)}
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

      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-slate-600 text-lg">No orders found</p>
          <p className="text-slate-500 text-sm mt-2">
            {searchTerm ? 'Try adjusting your search' : 'Orders will appear here when created'}
          </p>
        </div>
      ) : activeTab === 'pending_review' || activeTab === 'awaiting_customer_approval' ? (
        <div className="space-y-4">
          {filteredOrders.map(order => (
            <PendingOrderCard key={order.id} order={order} onUpdate={refetch} />
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
                      {order.id.slice(0, 8).toUpperCase()}
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
                          {format(new Date(order.event_date), 'MMM d, yyyy')}
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
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      order.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                      order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      order.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                      'bg-slate-100 text-slate-800'
                    }`}>
                      {order.status.replace('_', ' ')}
                    </span>
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
