import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { format, isToday, isFuture, isPast, parse } from 'date-fns';
import { Search, Calendar, User, Phone, Mail } from 'lucide-react';
import { OrderDetailModal } from './OrderDetailModal';

function PendingOrderCard({ order, onUpdate }: { order: any; onUpdate: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [orderItems, setOrderItems] = useState<any[]>([]);

  useEffect(() => {
    loadOrderItems();
  }, [order.id]);

  async function loadOrderItems() {
    const { data } = await supabase
      .from('order_items')
      .select('*, units(name)')
      .eq('order_id', order.id);
    if (data) setOrderItems(data);
  }

  async function handleAccept() {
    setProcessing(true);
    try {
      await supabase.from('orders').update({ status: 'confirmed' }).eq('id', order.id);
      await onUpdate();
      alert('Order accepted!');
    } catch (error) {
      console.error('Error accepting order:', error);
      alert('Failed to accept order');
    } finally {
      setProcessing(false);
    }
  }

  async function handleReject() {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;

    setProcessing(true);
    try {
      await supabase.from('orders').update({
        status: 'cancelled',
        cancellation_reason: reason
      }).eq('id', order.id);
      await onUpdate();
      alert('Order rejected');
    } catch (error) {
      console.error('Error rejecting order:', error);
      alert('Failed to reject order');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="border border-amber-300 bg-amber-50 rounded-lg p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            {order.customers?.first_name} {order.customers?.last_name}
          </h3>
          <p className="text-sm text-slate-600">{order.customers?.email}</p>
          <p className="text-sm text-slate-600">{order.customers?.phone}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-slate-700">
            {format(new Date(order.event_date), 'MMMM d, yyyy')}
          </p>
          <p className="text-sm text-slate-600">{order.start_window} - {order.end_window}</p>
        </div>
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-2">Items:</h4>
        <div className="space-y-1">
          {orderItems.map(item => (
            <p key={item.id} className="text-sm text-slate-600">
              • {item.units?.name} ({item.wet_or_dry}) x{item.qty}
            </p>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleAccept}
          disabled={processing}
          className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg"
        >
          Accept
        </button>
        <button
          onClick={handleReject}
          disabled={processing}
          className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold py-2 px-4 rounded-lg"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

type OrderTab = 'pending_review' | 'current' | 'upcoming' | 'all' | 'past' | 'cancelled';

export function OrdersManager() {
  const [activeTab, setActiveTab] = useState<OrderTab>('pending_review');
  const [orders, setOrders] = useState<any[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    filterAndSortOrders();
  }, [orders, activeTab, searchTerm]);

  useEffect(() => {
    determineDefaultTab();
  }, [orders]);

  async function loadOrders() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (first_name, last_name, email, phone),
          addresses (line1, line2, city, state, zip)
        `)
        .order('event_date', { ascending: true });

      if (error) throw error;
      if (data) setOrders(data);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  }

  function determineDefaultTab() {
    const pendingReview = orders.filter(o => o.status === 'pending_review' || o.status === 'draft').length;
    const current = orders.filter(o => isToday(new Date(o.event_date)) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft').length;
    const upcoming = orders.filter(o => isFuture(new Date(o.event_date)) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft').length;

    if (pendingReview > 0) {
      setActiveTab('pending_review');
    } else if (current > 0) {
      setActiveTab('current');
    } else if (upcoming > 0) {
      setActiveTab('upcoming');
    } else {
      setActiveTab('all');
    }
  }

  function filterAndSortOrders() {
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
      case 'pending_review':
        filtered = filtered.filter(o => o.status === 'pending_review' || o.status === 'draft');
        break;
      case 'current':
        filtered = filtered.filter(o => {
          const eventDate = new Date(o.event_date);
          return isToday(eventDate) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft';
        });
        break;
      case 'upcoming':
        filtered = filtered.filter(o => {
          const eventDate = new Date(o.event_date);
          return isFuture(eventDate) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft';
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

    setFilteredOrders(filtered);
  }

  function getTabCount(tab: OrderTab): number {
    switch (tab) {
      case 'pending_review':
        return orders.filter(o => o.status === 'pending_review' || o.status === 'draft').length;
      case 'current':
        return orders.filter(o => isToday(new Date(o.event_date)) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft').length;
      case 'upcoming':
        return orders.filter(o => isFuture(new Date(o.event_date)) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft').length;
      case 'past':
        return orders.filter(o => {
          const eventDate = new Date(o.event_date);
          return isPast(eventDate) && !isToday(eventDate) && o.status !== 'cancelled' && o.status !== 'pending_review' && o.status !== 'draft';
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
    { key: 'pending_review', label: 'Pending Review' },
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
      ) : activeTab === 'pending_review' ? (
        <div className="space-y-4">
          {filteredOrders.map(order => (
            <PendingOrderCard key={order.id} order={order} onUpdate={loadOrders} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Order ID</th>
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
                    <div className="text-xs text-slate-500">
                      {format(new Date(order.created_at), 'MMM d, yyyy')}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <User className="w-4 h-4 mr-2 text-slate-400" />
                      <div>
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
          onUpdate={loadOrders}
        />
      )}
    </div>
  );
}
