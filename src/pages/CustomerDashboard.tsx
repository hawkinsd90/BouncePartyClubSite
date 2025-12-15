import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package } from 'lucide-react';
import { Order, Payment } from '../types/orders';
import { useOrders } from '../hooks/useOrders';
import { useOrderDuplication } from '../hooks/useOrderDuplication';
import { loadOrderSummary, formatOrderSummary, OrderSummaryDisplay } from '../lib/orderSummary';
import { showToast } from '../lib/notifications';
import { CancelOrderModal } from '../components/customer-portal/CancelOrderModal';
import { OrderCard } from '../components/dashboard/OrderCard';
import { ReceiptModal } from '../components/dashboard/ReceiptModal';
import { DashboardTabs } from '../components/dashboard/DashboardTabs';

export function CustomerDashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { duplicateOrder } = useOrderDuplication();

  const { upcomingOrders, activeOrders, pastOrders, loading, reloadOrders } = useOrders(
    user?.id,
    user?.email
  );

  const [selectedReceipt, setSelectedReceipt] = useState<{ order: Order; payment: Payment } | null>(null);
  const [receiptSummary, setReceiptSummary] = useState<OrderSummaryDisplay | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelOrderDate, setCancelOrderDate] = useState<string | null>(null);

  const urlTab = searchParams.get('tab') as 'active' | 'upcoming' | 'past' | null;
  const activeTab = (urlTab && ['active', 'upcoming', 'past'].includes(urlTab)) ? urlTab : 'active';

  const changeTab = (tab: 'active' | 'upcoming' | 'past') => {
    setSearchParams({ tab });
  };

  useEffect(() => {
    if (!urlTab) {
      if (activeOrders.length > 0) {
        changeTab('active');
      } else if (upcomingOrders.length > 0) {
        changeTab('upcoming');
      } else if (pastOrders.length > 0) {
        changeTab('past');
      }
    }
  }, [activeOrders, upcomingOrders, pastOrders, urlTab]);

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

  function closeReceipt() {
    setSelectedReceipt(null);
    setReceiptSummary(null);
  }

  function handleCancelOrder(orderId: string, eventDate: string) {
    setCancelOrderId(orderId);
    setCancelOrderDate(eventDate);
  }

  function handleCancelSuccess() {
    setCancelOrderId(null);
    setCancelOrderDate(null);
    showToast('Your order has been cancelled', 'success');
    reloadOrders();
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
            <DashboardTabs
              activeTab={activeTab}
              activeOrdersCount={activeOrders.length}
              upcomingOrdersCount={upcomingOrders.length}
              pastOrdersCount={pastOrders.length}
              onTabChange={changeTab}
            />

            {currentOrders.length > 0 ? (
              <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                {currentOrders.map(order => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onViewReceipt={openReceipt}
                    onDuplicateOrder={duplicateOrder}
                    onCancelOrder={handleCancelOrder}
                  />
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

      {selectedReceipt && (
        <ReceiptModal
          order={selectedReceipt.order}
          payment={selectedReceipt.payment}
          summary={receiptSummary}
          loading={loadingReceipt}
          onClose={closeReceipt}
        />
      )}

      {cancelOrderId && cancelOrderDate && (
        <CancelOrderModal
          orderId={cancelOrderId}
          eventDate={cancelOrderDate}
          onClose={() => {
            setCancelOrderId(null);
            setCancelOrderDate(null);
          }}
          onSuccess={handleCancelSuccess}
        />
      )}
    </div>
  );
}
