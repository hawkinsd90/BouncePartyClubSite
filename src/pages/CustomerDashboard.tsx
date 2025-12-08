import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import {
  Calendar,
  MapPin,
  DollarSign,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Package,
  X,
  Eye
} from 'lucide-react';
import { formatCurrency } from '../lib/pricing';
import { useNavigate } from 'react-router-dom';

interface Order {
  id: string;
  status: string;
  event_date: string;
  event_end_date: string;
  location_type: string;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  tax_cents: number;
  deposit_due_cents: number;
  deposit_paid_cents: number;
  balance_due_cents: number;
  balance_paid_cents: number;
  created_at: string;
  customers: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  addresses: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  waiver_signed_at: string | null;
  signed_waiver_url: string | null;
  customer_id: string;
}

export function CustomerDashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [upcomingOrders, setUpcomingOrders] = useState<Order[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [pastOrders, setPastOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'upcoming' | 'past'>('active');

  useEffect(() => {
    if (!authLoading && user) {
      loadOrders();
    }
  }, [user, authLoading]);

  // Auto-select first non-empty tab
  useEffect(() => {
    if (activeOrders.length > 0 && activeTab !== 'active') {
      setActiveTab('active');
    } else if (activeOrders.length === 0 && upcomingOrders.length > 0 && activeTab === 'active') {
      setActiveTab('upcoming');
    } else if (activeOrders.length === 0 && upcomingOrders.length === 0 && pastOrders.length > 0) {
      setActiveTab('past');
    }
  }, [activeOrders, upcomingOrders, pastOrders]);

  async function loadOrders() {
    if (!user) return;

    setLoading(true);
    try {
      // Get the user's customer profile to find their contact_id
      const { data: profileData } = await supabase
        .from('customer_profiles')
        .select('contact_id')
        .eq('user_id', user.id)
        .maybeSingle();

      let customerIds: string[] = [];

      if (profileData?.contact_id) {
        // Get the contact's customer_id
        const { data: contactData } = await supabase
          .from('contacts')
          .select('customer_id')
          .eq('id', profileData.contact_id)
          .maybeSingle();

        if (contactData?.customer_id) {
          customerIds.push(contactData.customer_id);
        }
      }

      // Also find any orders that match the user's email directly
      const { data: emailCustomers } = await supabase
        .from('customers')
        .select('id')
        .eq('email', user.email);

      if (emailCustomers) {
        customerIds.push(...emailCustomers.map(c => c.id));
      }

      // Remove duplicates
      customerIds = Array.from(new Set(customerIds));

      if (customerIds.length === 0) {
        setLoading(false);
        return;
      }

      const { data: ordersData, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (*),
          addresses (*)
        `)
        .in('customer_id', customerIds)
        .order('event_date', { ascending: false });

      if (error) {
        console.error('Error loading orders:', error);
        return;
      }

      if (ordersData) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcoming: Order[] = [];
        const active: Order[] = [];
        const past: Order[] = [];

        ordersData.forEach((order: any) => {
          const eventDate = new Date(order.event_date);
          const eventEndDate = order.event_end_date ? new Date(order.event_end_date) : eventDate;

          // Active: event is happening now or workflow is in progress
          if (
            (eventDate <= today && eventEndDate >= today) ||
            ['en_route_delivery', 'delivered', 'en_route_pickup'].includes(order.workflow_status)
          ) {
            active.push(order);
          }
          // Upcoming: event hasn't started yet
          else if (eventDate > today && !['completed', 'cancelled', 'voided'].includes(order.status)) {
            upcoming.push(order);
          }
          // Past: completed, cancelled, or event ended
          else {
            past.push(order);
          }
        });

        setUpcomingOrders(upcoming);
        setActiveOrders(active);
        setPastOrders(past);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadge(order: Order) {
    const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
      draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700', icon: FileText },
      pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700', icon: Clock },
      confirmed: { label: 'Confirmed', className: 'bg-blue-100 text-blue-700', icon: CheckCircle },
      awaiting_customer_approval: { label: 'Awaiting Approval', className: 'bg-orange-100 text-orange-700', icon: AlertCircle },
      completed: { label: 'Completed', className: 'bg-green-100 text-green-700', icon: CheckCircle },
      cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700', icon: X },
      voided: { label: 'Voided', className: 'bg-gray-100 text-gray-500', icon: X },
    };

    const config = statusConfig[order.status] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.className}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    );
  }

  function getPaymentStatus(order: Order) {
    // If order is awaiting approval, don't show payment status yet
    if (order.status === 'awaiting_customer_approval' || order.status === 'draft' || order.status === 'pending') {
      return <span className="text-gray-600 font-medium">Pending Quote</span>;
    }

    const totalPaid = order.deposit_paid_cents + order.balance_paid_cents;
    const totalDue = order.deposit_due_cents + order.balance_due_cents;

    if (totalPaid >= totalDue) {
      return <span className="text-green-600 font-medium">Paid in Full</span>;
    } else if (order.deposit_paid_cents > 0) {
      return <span className="text-blue-600 font-medium">Deposit Paid</span>;
    } else {
      return <span className="text-orange-600 font-medium">Payment Due</span>;
    }
  }

  function OrderCard({ order }: { order: Order }) {
    const eventStartDate = new Date(order.event_date);
    const eventEndDate = order.event_end_date ? new Date(order.event_end_date) : eventStartDate;
    const isMultiDay = eventStartDate.toDateString() !== eventEndDate.toDateString();

    return (
      <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold text-gray-900">
                {isMultiDay
                  ? `${format(eventStartDate, 'MMM d')} - ${format(eventEndDate, 'MMM d, yyyy')}`
                  : format(eventStartDate, 'MMMM d, yyyy')}
              </h3>
              {getStatusBadge(order)}
            </div>
            <p className="text-sm text-gray-500">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {order.addresses && (
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div>{order.addresses.line1}</div>
                {order.addresses.line2 && <div>{order.addresses.line2}</div>}
                <div>{order.addresses.city}, {order.addresses.state} {order.addresses.zip}</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Package className="w-4 h-4" />
            <span className="capitalize">{order.location_type} Event</span>
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <DollarSign className="w-4 h-4" />
            <div className="flex items-center gap-3">
              <div>
                <span className="text-gray-600">Total: </span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency((
                    order.subtotal_cents +
                    order.travel_fee_cents +
                    order.surface_fee_cents +
                    (order.same_day_pickup_fee_cents || 0) +
                    (order.generator_fee_cents || 0) +
                    order.tax_cents +
                    (order.tip_cents || 0)
                  ) / 100)}
                </span>
              </div>
              <span className="text-gray-400">•</span>
              {getPaymentStatus(order)}
            </div>
          </div>

          {order.waiver_signed_at && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              <span>Waiver Signed</span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 flex gap-2">
          <button
            onClick={() => navigate(`/customer-portal/${order.id}`)}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <Eye className="w-4 h-4" />
            View Details
          </button>
          {order.signed_waiver_url && (
            <button
              onClick={() => window.open(order.signed_waiver_url!, '_blank')}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Waiver
            </button>
          )}
        </div>
      </div>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your orders...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    navigate('/login');
    return null;
  }

  const totalOrders = activeOrders.length + upcomingOrders.length + pastOrders.length;
  const currentOrders = activeTab === 'active' ? activeOrders : activeTab === 'upcoming' ? upcomingOrders : pastOrders;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Orders</h1>
          <p className="text-gray-600">View and manage your bounce house rentals</p>
        </div>

        {totalOrders > 0 ? (
          <>
            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
              <nav className="-mb-px flex gap-8" aria-label="Tabs">
                <button
                  onClick={() => setActiveTab('active')}
                  className={`
                    whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
                    ${activeTab === 'active'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Clock className="w-5 h-5" />
                  Active Orders
                  {activeOrders.length > 0 && (
                    <span className={`
                      ml-2 py-0.5 px-2 rounded-full text-xs font-medium
                      ${activeTab === 'active' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
                    `}>
                      {activeOrders.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('upcoming')}
                  className={`
                    whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
                    ${activeTab === 'upcoming'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Calendar className="w-5 h-5" />
                  Upcoming Orders
                  {upcomingOrders.length > 0 && (
                    <span className={`
                      ml-2 py-0.5 px-2 rounded-full text-xs font-medium
                      ${activeTab === 'upcoming' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
                    `}>
                      {upcomingOrders.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('past')}
                  className={`
                    whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
                    ${activeTab === 'past'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <CheckCircle className="w-5 h-5" />
                  Past Orders
                  {pastOrders.length > 0 && (
                    <span className={`
                      ml-2 py-0.5 px-2 rounded-full text-xs font-medium
                      ${activeTab === 'past' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
                    `}>
                      {pastOrders.length}
                    </span>
                  )}
                </button>
              </nav>
            </div>

            {/* Tab Content */}
            {currentOrders.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {currentOrders.map(order => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">
                  No {activeTab} orders
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Orders Yet</h3>
            <p className="text-gray-600 mb-6">Start by browsing our catalog and booking your first rental!</p>
            <button
              onClick={() => navigate('/catalog')}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Browse Catalog
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
