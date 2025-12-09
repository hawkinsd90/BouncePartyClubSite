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
  Eye,
  Copy
} from 'lucide-react';
import { formatCurrency } from '../lib/pricing';
import { useNavigate } from 'react-router-dom';
import { OrderSummary } from '../components/OrderSummary';
import { loadOrderSummary, formatOrderSummary, OrderSummaryDisplay } from '../lib/orderSummary';

interface Payment {
  id: string;
  type: string;
  amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
  created_at: string;
  paid_at: string | null;
}

interface OrderItem {
  id: string;
  unit_id: string;
  wet_or_dry: string;
  qty: number;
  unit_price_cents: number;
  units: {
    name: string;
  };
}

interface Order {
  id: string;
  status: string;
  event_date: string;
  event_end_date: string;
  location_type: string;
  subtotal_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents?: number;
  generator_fee_cents?: number;
  tax_cents: number;
  tip_cents?: number;
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
  payments?: Payment[];
  order_items?: OrderItem[];
}

function calculateOrderTotal(order: Order): number {
  return (
    order.subtotal_cents +
    order.travel_fee_cents +
    order.surface_fee_cents +
    (order.same_day_pickup_fee_cents || 0) +
    (order.generator_fee_cents || 0) +
    order.tax_cents +
    (order.tip_cents || 0)
  );
}

export function CustomerDashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [upcomingOrders, setUpcomingOrders] = useState<Order[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [pastOrders, setPastOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'upcoming' | 'past'>('active');
  const [selectedReceipt, setSelectedReceipt] = useState<{ order: Order; payment: Payment } | null>(null);
  const [receiptSummary, setReceiptSummary] = useState<OrderSummaryDisplay | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);

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

  async function openReceipt(order: Order, payment: Payment) {
    setSelectedReceipt({ order, payment });
    setLoadingReceipt(true);

    try {
      const summaryData = await loadOrderSummary(order.id);
      if (summaryData) {
        const formattedSummary = formatOrderSummary(summaryData);
        setReceiptSummary(formattedSummary);
      }
    } catch (error) {
      console.error('Error loading receipt summary:', error);
    } finally {
      setLoadingReceipt(false);
    }
  }

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
          addresses (*),
          payments (*),
          order_items (
            *,
            units (
              name
            )
          )
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
      return <span className="text-gray-600 font-medium">Awaiting Order Approval</span>;
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

  async function handleDuplicateOrder(orderId: string) {
    try {
      // Load order details including items
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          addresses (*)
        `)
        .eq('id', orderId)
        .single();

      if (orderError || !orderData) {
        alert('Failed to load order details');
        return;
      }

      // Load order items
      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId);

      if (itemsError || !itemsData) {
        alert('Failed to load order items');
        return;
      }

      if (itemsData.length === 0) {
        alert('This order has no items to duplicate.');
        return;
      }

      // Get all unit IDs from the order
      const unitIds = itemsData.map(item => item.unit_id);

      // Check which units still exist and are active
      const { data: unitsData, error: unitsError } = await supabase
        .from('units')
        .select('id, name, is_active')
        .in('id', unitIds);

      if (unitsError) {
        console.error('Error checking units:', unitsError);
        alert('Failed to validate rental items');
        return;
      }

      // Create a map of valid units
      const validUnitsMap = new Map(
        (unitsData || [])
          .filter(unit => unit.is_active !== false)
          .map(unit => [unit.id, unit])
      );

      // Separate valid and invalid items
      const validItems: any[] = [];
      const unavailableItems: string[] = [];

      itemsData.forEach(item => {
        if (validUnitsMap.has(item.unit_id)) {
          validItems.push(item);
        } else {
          unavailableItems.push(item.unit_name);
        }
      });

      // Show feedback to user
      if (unavailableItems.length > 0 && validItems.length === 0) {
        alert(
          'Unable to duplicate this order.\n\n' +
          'The following items are no longer available:\n' +
          unavailableItems.map(name => `• ${name}`).join('\n') +
          '\n\nPlease browse our catalog to see current rental options.'
        );
        return;
      } else if (unavailableItems.length > 0) {
        const proceed = confirm(
          'Some items from this order are no longer available:\n\n' +
          unavailableItems.map(name => `• ${name}`).join('\n') +
          '\n\nThe remaining items will be added to your cart. Continue?'
        );
        if (!proceed) return;
      }

      // Create cart items from valid items only
      const cartItems = validItems.map(item => ({
        unit_id: item.unit_id,
        unit_name: item.unit_name,
        wet_or_dry: item.wet_or_dry as 'dry' | 'water',
        unit_price_cents: item.unit_price_cents,
        qty: item.qty,
        is_combo: item.is_combo || false,
      }));

      // Store cart in localStorage
      localStorage.setItem('bpc_cart', JSON.stringify(cartItems));

      // Store quote prefill data (address and settings, but NOT dates)
      const prefillData = {
        address: orderData.addresses ? {
          street: orderData.addresses.line1,
          city: orderData.addresses.city,
          state: orderData.addresses.state,
          zip: orderData.addresses.zip,
          lat: orderData.addresses.lat,
          lng: orderData.addresses.lng,
          formatted_address: `${orderData.addresses.line1}, ${orderData.addresses.city}, ${orderData.addresses.state} ${orderData.addresses.zip}`,
        } : null,
        location_type: orderData.location_type,
        pickup_preference: orderData.pickup_preference || 'next_day',
        can_stake: orderData.can_stake,
        has_generator: orderData.generator_qty > 0,
        has_pets: orderData.has_pets,
        special_details: orderData.special_details || '',
        address_line2: orderData.addresses?.line2 || '',
        // Explicitly clear dates - customer must select new ones
        event_date: '',
        event_end_date: '',
        start_window: orderData.start_window || '09:00',
        end_window: orderData.end_window || '17:00',
      };

      localStorage.setItem('bpc_quote_prefill', JSON.stringify(prefillData));
      localStorage.setItem('bpc_duplicate_order', 'true');

      // Navigate to quote page
      navigate('/quote');
    } catch (error) {
      console.error('Error duplicating order:', error);
      alert('Failed to duplicate order');
    }
  }

  function OrderCard({ order }: { order: Order }) {
    const eventStartDate = new Date(order.event_date);
    const eventEndDate = order.event_end_date ? new Date(order.event_end_date) : eventStartDate;
    const isMultiDay = eventStartDate.toDateString() !== eventEndDate.toDateString();

    return (
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 hover:shadow-lg transition-shadow">
        <div className="mb-4">
          <div className="flex items-start gap-2 mb-2 flex-wrap">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 flex-grow min-w-0">
              {isMultiDay
                ? `${format(eventStartDate, 'MMM d')} - ${format(eventEndDate, 'MMM d, yyyy')}`
                : format(eventStartDate, 'MMMM d, yyyy')}
            </h3>
            {getStatusBadge(order)}
          </div>
          <p className="text-xs sm:text-sm text-gray-500">
            Order #{order.id.slice(0, 8).toUpperCase()}
          </p>
        </div>

        <div className="space-y-2.5 sm:space-y-3">
          {order.addresses && (
            <div className="flex items-start gap-2 text-xs sm:text-sm text-gray-600">
              <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <div className="break-words">{order.addresses.line1}</div>
                {order.addresses.line2 && <div className="break-words">{order.addresses.line2}</div>}
                <div>{order.addresses.city}, {order.addresses.state} {order.addresses.zip}</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
            <Package className="w-4 h-4 flex-shrink-0" />
            <span className="capitalize">{order.location_type} Event</span>
          </div>

          {order.order_items && order.order_items.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <h4 className="text-xs font-semibold text-gray-700 mb-2">Rental Items:</h4>
              <div className="space-y-1.5">
                {order.order_items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">
                        {item.qty > 1 && `${item.qty}x `}
                        {item.units.name}
                      </span>
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                        {item.wet_or_dry === 'water' ? 'Wet' : 'Dry'}
                      </span>
                    </div>
                    <span className="text-gray-500 text-[11px]">
                      {formatCurrency(item.unit_price_cents * item.qty)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs sm:text-sm text-gray-600">
            <DollarSign className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div>
                <span className="text-gray-600">Total: </span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(calculateOrderTotal(order))}
                </span>
              </div>
              <span className="text-gray-400 hidden sm:inline">•</span>
              {getPaymentStatus(order)}
            </div>
          </div>

          {Array.isArray(order.payments) && order.payments.filter(p => p.status === 'succeeded').length > 0 && (
            <div className="flex items-start gap-2 text-xs sm:text-sm">
              <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400" />
              <div className="flex gap-2 flex-wrap">
                {order.payments
                  .filter(p => p.status === 'succeeded')
                  .map(payment => (
                    <button
                      key={payment.id}
                      onClick={() => openReceipt(order, payment)}
                      className="text-blue-600 hover:text-blue-700 underline"
                    >
                      View {payment.type === 'deposit' ? 'Deposit' : 'Balance'} Receipt
                    </button>
                  ))}
              </div>
            </div>
          )}

          {order.waiver_signed_at && (
            <div className="flex items-center gap-2 text-xs sm:text-sm text-green-600">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>Waiver Signed</span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/customer-portal/${order.id}`)}
              className="flex-1 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm"
            >
              <Eye className="w-4 h-4 flex-shrink-0" />
              <span className="hidden xs:inline">View Details</span>
              <span className="xs:hidden">Details</span>
            </button>
            {order.signed_waiver_url && (
              <button
                onClick={() => window.open(order.signed_waiver_url!, '_blank')}
                className="px-3 sm:px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm"
              >
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span className="hidden sm:inline">Waiver</span>
              </button>
            )}
          </div>
          <button
            onClick={() => handleDuplicateOrder(order.id)}
            className="w-full px-3 sm:px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm font-medium"
          >
            <Copy className="w-4 h-4 flex-shrink-0" />
            <span>Duplicate Order</span>
          </button>
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
    <div className="min-h-screen bg-gray-50 py-4 sm:py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">My Orders</h1>
          <p className="text-sm sm:text-base text-gray-600">View and manage your bounce house rentals</p>
        </div>

        {totalOrders > 0 ? (
          <>
            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto">
              <nav className="-mb-px flex gap-4 sm:gap-8 min-w-min" aria-label="Tabs">
                <button
                  onClick={() => setActiveTab('active')}
                  className={`
                    whitespace-nowrap py-3 md:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-colors
                    ${activeTab === 'active'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                  <span className="hidden sm:inline">Active Orders</span>
                  <span className="sm:hidden">Active</span>
                  {activeOrders.length > 0 && (
                    <span className={`
                      ml-1 sm:ml-2 py-0.5 px-1.5 sm:px-2 rounded-full text-xs font-medium flex-shrink-0
                      ${activeTab === 'active' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
                    `}>
                      {activeOrders.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('upcoming')}
                  className={`
                    whitespace-nowrap py-3 md:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-colors
                    ${activeTab === 'upcoming'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Calendar className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                  <span className="hidden sm:inline">Upcoming Orders</span>
                  <span className="sm:hidden">Upcoming</span>
                  {upcomingOrders.length > 0 && (
                    <span className={`
                      ml-1 sm:ml-2 py-0.5 px-1.5 sm:px-2 rounded-full text-xs font-medium flex-shrink-0
                      ${activeTab === 'upcoming' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
                    `}>
                      {upcomingOrders.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('past')}
                  className={`
                    whitespace-nowrap py-3 md:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-colors
                    ${activeTab === 'past'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                  <span className="hidden sm:inline">Past Orders</span>
                  <span className="sm:hidden">Past</span>
                  {pastOrders.length > 0 && (
                    <span className={`
                      ml-1 sm:ml-2 py-0.5 px-1.5 sm:px-2 rounded-full text-xs font-medium flex-shrink-0
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
              <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                {currentOrders.map(order => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 sm:py-12 bg-white rounded-lg border border-gray-200">
                <Package className="w-10 h-10 sm:w-12 sm:h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm sm:text-base text-gray-500">
                  No {activeTab} orders
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 sm:py-12">
            <Package className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">No Orders Yet</h3>
            <p className="text-sm sm:text-base text-gray-600 mb-6 px-4">Start by browsing our catalog and booking your first rental!</p>
            <button
              onClick={() => navigate('/catalog')}
              className="px-5 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white text-sm sm:text-base rounded-lg hover:bg-blue-700 transition-colors"
            >
              Browse Catalog
            </button>
          </div>
        )}
      </div>

      {/* Receipt Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg max-w-4xl w-full my-8">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Payment Receipt</h2>
                <button
                  onClick={() => {
                    setSelectedReceipt(null);
                    setReceiptSummary(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {loadingReceipt ? (
                <div className="py-12 text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="mt-4 text-gray-600">Loading receipt details...</p>
                </div>
              ) : (
                <div className="space-y-6 max-h-[calc(90vh-200px)] overflow-y-auto">
                  {/* Business Info */}
                  <div className="text-center pb-6 border-b border-gray-200">
                    <img
                      src="/bounce%20party%20club%20logo.png"
                      alt="Bounce Party Club"
                      className="h-20 mx-auto mb-3 object-contain"
                    />
                    <h3 className="text-xl font-bold text-gray-900">Bounce Party Club</h3>
                    <p className="text-gray-600 mt-1">(313) 889-3860</p>
                  </div>

                  {/* Payment Details */}
                  <div className="grid grid-cols-2 gap-4 text-sm bg-blue-50 p-4 rounded-lg">
                    <div>
                      <p className="text-gray-600">Payment Received</p>
                      <p className="font-semibold text-gray-900">
                        {format(new Date(selectedReceipt.payment.paid_at || selectedReceipt.payment.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Order ID</p>
                      <p className="font-semibold text-gray-900 text-xs">
                        #{selectedReceipt.order.id.slice(0, 8)}
                      </p>
                    </div>
                  </div>

                  {/* Amount Paid Highlight */}
                  <div className="bg-green-50 p-4 rounded-lg border-2 border-green-200">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-semibold text-gray-900">Amount Paid</span>
                      <span className="text-2xl font-bold text-green-600">
                        {formatCurrency(selectedReceipt.payment.amount_cents)}
                      </span>
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-3">Customer Information</h4>
                    <div className="text-sm space-y-2">
                      <p>
                        <span className="text-gray-600">Name: </span>
                        <span className="font-medium text-gray-900">
                          {selectedReceipt.order.customers.first_name} {selectedReceipt.order.customers.last_name}
                        </span>
                      </p>
                      <p>
                        <span className="text-gray-600">Email: </span>
                        <span className="font-medium text-gray-900">{selectedReceipt.order.customers.email}</span>
                      </p>
                      <p>
                        <span className="text-gray-600">Phone: </span>
                        <span className="font-medium text-gray-900">{selectedReceipt.order.customers.phone}</span>
                      </p>
                    </div>
                  </div>

                  {/* Event Info */}
                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-3">Event Information</h4>
                    <div className="text-sm space-y-2">
                      <p>
                        <span className="text-gray-600">Date: </span>
                        <span className="font-medium text-gray-900">
                          {format(new Date(selectedReceipt.order.event_date), 'MMMM d, yyyy')}
                          {selectedReceipt.order.event_end_date && selectedReceipt.order.event_end_date !== selectedReceipt.order.event_date && (
                            <> - {format(new Date(selectedReceipt.order.event_end_date), 'MMMM d, yyyy')}</>
                          )}
                        </span>
                      </p>
                      {selectedReceipt.order.addresses && (
                        <p>
                          <span className="text-gray-600">Location: </span>
                          <span className="font-medium text-gray-900">
                            {selectedReceipt.order.addresses.line1}, {selectedReceipt.order.addresses.city}, {selectedReceipt.order.addresses.state} {selectedReceipt.order.addresses.zip}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Itemized Order Summary */}
                  {receiptSummary && (
                    <div className="pt-4 border-t-2 border-gray-300">
                      <OrderSummary
                        summary={receiptSummary}
                        title="Complete Order Details"
                        showDeposit={false}
                        showTip={true}
                      />
                    </div>
                  )}

                  {/* Payment Status Summary */}
                  <div className="pt-4 border-t-2 border-gray-300">
                    <h4 className="font-semibold text-gray-900 mb-3">Payment Status</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-700">Deposit Paid:</span>
                        <span className="font-medium text-green-600">{formatCurrency(selectedReceipt.order.deposit_paid_cents)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-700">Balance Paid:</span>
                        <span className="font-medium text-green-600">{formatCurrency(selectedReceipt.order.balance_paid_cents)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-gray-200 font-semibold text-lg">
                        <span className="text-gray-900">Remaining Balance:</span>
                        <span className="text-blue-700">
                          {receiptSummary
                            ? formatCurrency(receiptSummary.total - selectedReceipt.order.deposit_paid_cents - selectedReceipt.order.balance_paid_cents)
                            : formatCurrency(calculateOrderTotal(selectedReceipt.order) - selectedReceipt.order.deposit_paid_cents - selectedReceipt.order.balance_paid_cents)
                          }
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
                    <p>Thank you for your business!</p>
                    <p className="mt-2">Questions? Contact us at (313) 889-3860</p>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="mt-6 pt-4 border-t border-gray-200 flex gap-3">
                <button
                  onClick={() => window.print()}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  disabled={loadingReceipt}
                >
                  Print Receipt
                </button>
                <button
                  onClick={() => {
                    setSelectedReceipt(null);
                    setReceiptSummary(null);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
